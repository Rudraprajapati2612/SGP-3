"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const client_1 = require("@prisma/client");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const Factory_json_1 = __importDefault(require("./abi/Factory.json"));
const Pair_json_1 = __importDefault(require("./abi/Pair.json"));
const ERC20_json_1 = __importDefault(require("./abi/ERC20.json"));
const prisma = new client_1.PrismaClient();
const provider = new ethers_1.ethers.JsonRpcProvider(process.env.RPC_URL);
const factory = new ethers_1.ethers.Contract(process.env.FACTORY_ADDRESS, Factory_json_1.default, provider);
// helper: fetch token metadata
const getTokenMeta = async (address) => {
    const token = new ethers_1.ethers.Contract(address, ERC20_json_1.default, provider);
    const [symbol, decimals, name] = await Promise.all([
        token.symbol(),
        token.decimals(), // careful: it’s "decimals" not "decimal"
        token.name().catch(() => null), // optional
    ]);
    return { symbol, decimals, name };
};
// attach listener for swaps + liquidity events for a given pool
const attachPairListener = async (pairAddress) => {
    const pair = new ethers_1.ethers.Contract(pairAddress, Pair_json_1.default, provider);
    console.log(`Listening to pair: ${pairAddress}`);
    // Swap event
    pair.on("Swap", async (sender, amount0In, amount1In, amount0Out, amount1Out, to, event) => {
        console.log("Swap detected in:", pairAddress);
        try {
            await prisma.swap.create({
                data: {
                    poolId: (await prisma.pool.findUnique({ where: { address: pairAddress } })).id,
                    trader: sender,
                    amountIn: amount0In.toString() || amount1In.toString(),
                    amountOut: amount0Out.toString() || amount1Out.toString(),
                    tokenIn: amount0In > 0 ? "token0" : "token1",
                    tokenOut: amount0Out > 0 ? "token0" : "token1",
                },
            });
        }
        catch (err) {
            console.error("Error saving swap:", err);
        }
    });
    // Mint (liquidity added)
    pair.on("Mint", async (sender, amount0, amount1, event) => {
        console.log("Liquidity added in:", pairAddress);
        try {
            await prisma.liquidity.create({
                data: {
                    poolId: (await prisma.pool.findUnique({ where: { address: pairAddress } })).id,
                    provider: sender,
                    amountA: amount0.toString(),
                    amountB: amount1.toString(),
                },
            });
        }
        catch (err) {
            console.error("Error saving liquidity:", err);
        }
    });
    // Burn (liquidity removed)
    pair.on("Burn", async (sender, amount0, amount1, to, event) => {
        console.log("Liquidity removed in:", pairAddress);
        try {
            await prisma.liquidity.create({
                data: {
                    poolId: (await prisma.pool.findUnique({ where: { address: pairAddress } })).id,
                    provider: sender,
                    amountA: "-" + amount0.toString(),
                    amountB: "-" + amount1.toString(),
                },
            });
        }
        catch (err) {
            console.error("Error saving liquidity:", err);
        }
    });
};
async function main() {
    console.log("Listening for events...");
    // Listen for new pools
    factory.on("PairCreated", async (tokenA, tokenB, pair, event) => {
        console.log("New pool:", tokenA, tokenB, pair);
        const [metaA, metaB] = await Promise.all([
            getTokenMeta(tokenA),
            getTokenMeta(tokenB),
        ]);
        // Insert tokens if not exist
        const [tA, tB] = await Promise.all([
            prisma.token.upsert({
                where: { address: tokenA },
                update: {},
                create: {
                    address: tokenA,
                    symbol: metaA.symbol,
                    name: metaA.name ?? undefined,
                    decimals: metaA.decimals,
                },
            }),
            prisma.token.upsert({
                where: { address: tokenB },
                update: {},
                create: {
                    address: tokenB,
                    symbol: metaB.symbol,
                    name: metaB.name ?? undefined,
                    decimals: metaB.decimals,
                },
            }),
        ]);
        await prisma.pool.create({
            data: {
                address: pair,
                tokenAId: tA.id,
                tokenBId: tB.id,
            },
        });
        // Attach listeners for swaps + liquidity
        attachPairListener(pair);
    });
    // Bootstrap: attach listeners to already deployed pools
    const pools = await prisma.pool.findMany();
    for (const pool of pools) {
        attachPairListener(pool.address);
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
