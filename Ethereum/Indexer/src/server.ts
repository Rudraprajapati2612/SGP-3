import express from "express";
import { PrismaClient } from "@prisma/client";
import { ethers } from "ethers";
import cors from "cors";
import dotenv from "dotenv";
import routerAbi from "./abi/Router.json" with { type: "json" };

dotenv.config();

const app = express();
const prisma = new PrismaClient();

// Middleware
app.use(cors({
  origin: "http://localhost:3001",
  credentials: true
}));
app.use(express.json());

// Blockchain setup
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const router = new ethers.Contract(process.env.ROUTER_ADDRESS!, routerAbi, provider);

// ===== EXISTING ENDPOINTS =====

app.get("/pools", async (req, res) => {
  try {
    const pools = await prisma.pool.findMany({
      include: {
        tokenA: {
          select: {
            id: true,
            address: true,
            symbol: true,
            name: true,
            decimals: true,
          },
        },
        tokenB: {
          select: {
            id: true,
            address: true,
            symbol: true,
            name: true,
            decimals: true,
          },
        },
        liquidity: true,
        swaps: true,
      },
    });

    res.json(
      pools.map(pool => ({
        ...pool,
        tokenA: { ...pool.tokenA, decimals: pool.tokenA.decimals.toString() },
        tokenB: { ...pool.tokenB, decimals: pool.tokenB.decimals.toString() },
      }))
    );
  } catch (err: any) {
    console.error("❌ Prisma error:", err);
    res.status(500).json({ error: "Failed to fetch pools", details: err.message });
  }
});

app.get("/pool/:id", async (req, res) => {
  try {
    const ID = Number(req.params.id);
    const pool = await prisma.pool.findUnique({
      where: { id: ID },
      include: {
        tokenA: true,
        tokenB: true,
        swaps: { orderBy: { createdAt: "desc" }, take: 50 },
        liquidity: true,
      },
    });
    
    if (!pool) {
      return res.status(404).json({
        error: "Pool not Found"
      });
    }

    const reserveA = pool.liquidity.reduce((acc, l) => acc + Number(l.amountA), 0);
    const reserveB = pool.liquidity.reduce((acc, l) => acc + Number(l.amountB), 0);
    const tvl = reserveA + reserveB;
    
    res.json({
      ...pool,
      reserves: { reserveA, reserveB },
      tvl,
      tokenA: { ...pool.tokenA, decimals: pool.tokenA.decimals.toString() },
      tokenB: { ...pool.tokenB, decimals: pool.tokenB.decimals.toString() },
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch pool details" });
  }
});

// ===== NEW ROUTING ENDPOINTS =====

// Get optimal swap path between two tokens
app.get("/optimal-path/:tokenA/:tokenB", async (req, res) => {
  try {
    const { tokenA, tokenB } = req.params;
    const { amount = "1000000000000000000" } = req.query; // Default 1 ETH worth

    const paths = await findOptimalPath(tokenA, tokenB, amount as string);
    
    res.json({
      direct: paths.direct,
      optimal: paths.optimal,
      allPaths: paths.allPaths,
      gasEstimates: paths.gasEstimates
    });
  } catch (error) {
    console.error("Optimal path error:", error);
    res.status(500).json({ error: "Failed to find optimal path" });
  }
});

// Get multi-hop quote
app.post("/multi-hop-quote", async (req, res) => {
  try {
    const { path, amountIn } = req.body;
    
    if (!Array.isArray(path) || path.length < 2) {
      return res.status(400).json({ error: "Invalid path" });
    }

    const amounts = await router.getAmountsOut(amountIn, path);
    const gasEstimate = await estimateMultiHopGas(path, amountIn);
    
    res.json({
      path,
      amountIn,
      amountOut: amounts[amounts.length - 1].toString(),
      amounts: amounts.map((a: { toString: () => any; }) => a.toString()),
      gasEstimate: gasEstimate.toString(),
      hops: path.length - 1
    });
  } catch (error) {
    console.error("Multi-hop quote error:", error);
    res.status(500).json({ error: "Failed to get quote" });
  }
});

// Get all possible paths between tokens (with depth limit)
app.get("/all-paths/:tokenA/:tokenB", async (req, res) => {
  try {
    const { tokenA, tokenB } = req.params;
    const maxHops = Math.min(parseInt(req.query.maxHops as string) || 3, 4); // Limit to 4 hops max
    
    const allPaths = await findAllPaths(tokenA, tokenB, maxHops);
    
    res.json({
      tokenA,
      tokenB,
      maxHops,
      pathsFound: allPaths.length,
      paths: allPaths
    });
  } catch (error) {
    console.error("All paths error:", error);
    res.status(500).json({ error: "Failed to find paths" });
  }
});

// Path performance analytics
app.get("/path-analytics/:tokenA/:tokenB", async (req, res) => {
  try {
    const { tokenA, tokenB } = req.params;
    
    // Get historical swap data for these tokens
    const swaps = await prisma.swap.findMany({
      where: {
        OR: [
          { tokenIn: tokenA, tokenOut: tokenB },
          { tokenIn: tokenB, tokenOut: tokenA }
        ]
      },
      include: { pool: { include: { tokenA: true, tokenB: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    // Analyze swap patterns
    const analytics = {
      totalSwaps: swaps.length,
      popularPaths: getPopularPaths(swaps),
      liquidityDistribution: await getLiquidityDistribution(tokenA, tokenB),
      volumeByToken: getVolumeByToken(swaps)
    };

    res.json(analytics);
  } catch (error) {
    console.error("Path analytics error:", error);
    res.status(500).json({ error: "Failed to get analytics" });
  }
});

// Get tokens for dropdown/search
app.get("/tokens", async (req, res) => {
  try {
    const tokens = await prisma.token.findMany({
      select: {
        id: true,
        address: true,
        symbol: true,
        name: true,
        decimals: true
      }
    });

    res.json(tokens.map(token => ({
      ...token,
      decimals: token.decimals.toString()
    })));
  } catch (error) {
    console.error("Tokens fetch error:", error);
    res.status(500).json({ error: "Failed to fetch tokens" });
  }
});

// Get user portfolio (uncommented and fixed)
app.get("/portfolio/:user", async (req, res) => {
  try {
    const userAddress = req.params.user;
    const positions = await prisma.liquidity.findMany({
      where: { provider: userAddress },
      include: {
        pool: {
          include: {
            tokenA: true,
            tokenB: true
          }
        }
      }
    });

    // Group positions by pool
    const groupedPositions = new Map();
    
    positions.forEach(pos => {
      const poolKey = `${pos.pool.tokenA.symbol}-${pos.pool.tokenB.symbol}`;
      if (!groupedPositions.has(poolKey)) {
        groupedPositions.set(poolKey, {
          pool: poolKey,
          poolId: pos.poolId,
          tokenA: pos.pool.tokenA,
          tokenB: pos.pool.tokenB,
          totalAmountA: 0,
          totalAmountB: 0,
          positions: []
        });
      }
      
      const group = groupedPositions.get(poolKey);
      group.totalAmountA += Number(pos.amountA);
      group.totalAmountB += Number(pos.amountB);
      group.positions.push(pos);
    });

    const formatted = Array.from(groupedPositions.values()).map(group => ({
      pool: group.pool,
      poolId: group.poolId,
      tokenA: { ...group.tokenA, decimals: group.tokenA.decimals.toString() },
      tokenB: { ...group.tokenB, decimals: group.tokenB.decimals.toString() },
      liquidityProvided: {
        tokenA: group.totalAmountA.toString(),
        tokenB: group.totalAmountB.toString(),
      },
      positionsCount: group.positions.length
    }));

    res.json(formatted);
  } catch (error) {
    console.error("Portfolio fetch error:", error);
    res.status(500).json({ error: "Failed to fetch portfolio" });
  }
});

// ===== HELPER FUNCTIONS =====

// Helper function: Find optimal path using graph search
async function findOptimalPath(tokenA: string, tokenB: string, testAmount: string) {
  const paths = {
    direct: null as any,
    optimal: null as any,
    allPaths: [] as any[],
    gasEstimates: {}
  };

  // Get all available pools from database
  const pools = await prisma.pool.findMany({
    include: { tokenA: true, tokenB: true }
  });

  // Build adjacency list (graph of token connections)
  const graph = buildTokenGraph(pools);
  
  // Find all possible paths (BFS with depth limit)
  const allPaths = findAllPathsBFS(graph, tokenA, tokenB, 4); // Max 4 hops
  
  if (allPaths.length === 0) {
    console.log(`No paths found between ${tokenA} and ${tokenB}`);
    return paths;
  }

  // Test each path for best output
  let bestPath = null;
  let bestOutput = "0";
  
  for (const path of allPaths) {
    try {
      const amounts = await router.getAmountsOut(testAmount, path);
      const output = amounts[amounts.length - 1];
      
      paths.allPaths.push({
        path,
        expectedOutput: output.toString(),
        hops: path.length - 1,
        gasEstimate: (await estimateMultiHopGas(path, testAmount)).toString()
      });

      if (output > bestOutput) {
        bestOutput = output.toString();
        bestPath = path;
      }

      // Check if direct path exists
      if (path.length === 2) {
        paths.direct = {
          path,
          expectedOutput: output.toString(),
          hops: 1,
          gasEstimate: (await estimateMultiHopGas(path, testAmount)).toString()
        };
      }
    } catch (error: any) {
      // Path doesn't have liquidity, skip
      console.log(`Path ${path.join(' -> ')} failed:`, error.message);
    }
  }

  if (bestPath) {
    paths.optimal = {
      path: bestPath,
      expectedOutput: bestOutput,
      hops: bestPath.length - 1,
      gasEstimate: (await estimateMultiHopGas(bestPath, testAmount)).toString()
    };
  }

  return paths;
}

// Build token connection graph from pools
function buildTokenGraph(pools: any[]) {
  const graph = new Map();
  
  for (const pool of pools) {
    const tokenA = pool.tokenA.address;
    const tokenB = pool.tokenB.address;
    
    if (!graph.has(tokenA)) graph.set(tokenA, []);
    if (!graph.has(tokenB)) graph.set(tokenB, []);
    
    graph.get(tokenA).push(tokenB);
    graph.get(tokenB).push(tokenA);
  }
  
  return graph;
}

// Find all paths using BFS (Breadth-First Search)
function findAllPathsBFS(graph: Map<string, string[]>, start: string, end: string, maxDepth: number) {
  const paths: string[][] = [];
  const queue: string[][] = [[start]];
  const visited = new Set<string>();
  
  while (queue.length > 0) {
    const currentPath = queue.shift()!;
    const currentNode = currentPath[currentPath.length - 1];
    
    // Stop if path is too long
    if (currentPath.length > maxDepth + 1) continue;
    
    // Found destination
    if (currentNode === end && currentPath.length > 1) {
      paths.push([...currentPath]);
      continue;
    }
    
    // Avoid revisiting same partial paths
    const pathKey = currentPath.join(',');
    if (visited.has(pathKey)) continue;
    visited.add(pathKey);
    
    const neighbors = graph.get(currentNode) || [];
    
    for (const neighbor of neighbors) {
      // Prevent cycles - don't revisit tokens already in path
      if (!currentPath.includes(neighbor)) {
        queue.push([...currentPath, neighbor]);
      }
    }
  }
  
  return paths;
}

// Find all paths (simplified version for the endpoint)
async function findAllPaths(tokenA: string, tokenB: string, maxHops: number) {
  const pools = await prisma.pool.findMany({
    include: { tokenA: true, tokenB: true }
  });

  const graph = buildTokenGraph(pools);
  const allPaths = findAllPathsBFS(graph, tokenA, tokenB, maxHops);
  
  return allPaths.map(path => ({
    path,
    hops: path.length - 1,
    tokens: path.length
  }));
}

// Estimate gas for multi-hop swap
async function estimateMultiHopGas(path: string[], amountIn: string) {
  try {
    // Base gas + gas per hop
    const baseGas = 60000n; // Base transaction gas
    const gasPerHop = 120000n; // Approximate gas per swap
    const hops = BigInt(path.length - 1);
    
    return baseGas + (gasPerHop * hops);
  } catch (error) {
    return 300000n; // Fallback estimate
  }
}

// Analytics helper functions
function getPopularPaths(swaps: any[]) {
  const pathCounts = new Map();
  
  for (const swap of swaps) {
    const path = `${swap.tokenIn}->${swap.tokenOut}`;
    pathCounts.set(path, (pathCounts.get(path) || 0) + 1);
  }
  
  return Array.from(pathCounts.entries())
    .sort(([,a], [,b]) => (b as number) - (a as number))
    .slice(0, 5)
    .map(([path, count]) => ({ path, count }));
}

function getVolumeByToken(swaps: any[]) {
  const volumeMap = new Map();
  
  for (const swap of swaps) {
    const tokenIn = swap.tokenIn;
    const tokenOut = swap.tokenOut;
    const amountIn = Number(swap.amountIn);
    const amountOut = Number(swap.amountOut);
    
    volumeMap.set(tokenIn, (volumeMap.get(tokenIn) || 0) + amountIn);
    volumeMap.set(tokenOut, (volumeMap.get(tokenOut) || 0) + amountOut);
  }
  
  return Array.from(volumeMap.entries())
    .sort(([,a], [,b]) => (b as number) - (a as number))
    .slice(0, 10)
    .map(([token, volume]) => ({ token, volume }));
}

async function getLiquidityDistribution(tokenA: string, tokenB: string) {
  const pools = await prisma.pool.findMany({
    where: {
      OR: [
        { tokenA: { address: tokenA } },
        { tokenB: { address: tokenA } },
        { tokenA: { address: tokenB } },
        { tokenB: { address: tokenB } }
      ]
    },
    include: { 
      tokenA: true, 
      tokenB: true, 
      liquidity: true 
    }
  });

  return pools.map(pool => ({
    poolAddress: pool.address,
    pair: `${pool.tokenA.symbol}/${pool.tokenB.symbol}`,
    totalLiquidity: pool.liquidity.reduce((acc, l) => 
      acc + Math.abs(Number(l.amountA)) + Math.abs(Number(l.amountB)), 0
    ),
    liquidityProviders: pool.liquidity.length
  }));
}

// ===== SERVER START =====
app.listen(3000, () => {
  console.log("Backend Server Started on port 3000");
  console.log("Available endpoints:");
  console.log("- GET /pools - List all pools");
  console.log("- GET /pool/:id - Get specific pool details");
  console.log("- GET /tokens - List all tokens");
  console.log("- GET /portfolio/:user - Get user's liquidity positions");
  console.log("- GET /optimal-path/:tokenA/:tokenB - Find optimal swap path");
  console.log("- POST /multi-hop-quote - Get multi-hop swap quote");
  console.log("- GET /all-paths/:tokenA/:tokenB - Find all possible paths");
  console.log("- GET /path-analytics/:tokenA/:tokenB - Get path analytics");
});