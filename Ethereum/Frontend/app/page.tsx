"use client"

import { useEffect, useState } from "react"
import { ethers } from "ethers"
import { CONTRACTS, TOKEN_LIST } from "./contracts"

import factoryAbi from "./abis/AMMFactory.json"
import ammAbi from "./abis/AMM.json"
import routerAbi from "./abis/AMMRouter.json"
import erc20Abi from "./abis/ERC20.json"
import AMMPairABI from "./abis/AMM.json"

type signerLike = ethers.Signer | null

// Pool types for API data
interface Token {
  id: number
  address: string
  symbol: string
  name?: string
  decimals: number | string
}

interface Pool {
  id: number
  address: string
  tokenA: Token
  tokenB: Token
  liquidity: Array<{
    amountA: string
    amountB: string
    provider: string
    createdAt: string
  }>
  swaps?: Array<{
    trader: string
    amountIn: string
    amountOut: string
    tokenIn: string
    tokenOut: string
    createdAt: string
  }>
}

interface PoolWithLiveReserves extends Pool {
  liveReserves?: {
    reserveA: string
    reserveB: string
    reserveAFormatted: number
    reserveBFormatted: number
    lastUpdated: Date
    isLoading: boolean
    error?: string
  }
}

interface UserLPPosition {
  lpBalance: string
  sharePercentage: number
  shareOfReserveA: number
  shareOfReserveB: number
}

interface PoolWithUserPosition extends PoolWithLiveReserves {
  userPosition?: UserLPPosition
}

const zero = (v = 0n) => v === 0n
const isZeroAddr = (a: string) => a === ethers.ZeroAddress

export default function SwapLiTApp() {
  const [account, setAccount] = useState<string>("")
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null)
  const [signer, setSigner] = useState<signerLike>(null)

  // Pool data from API
  const [pools, setPools] = useState<Pool[]>([])
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null)
  const [loadingPools, setLoadingPools] = useState(false)
  const [showPools, setShowPools] = useState(false)

  // Loading states for better UX
  const [isCreatingPair, setIsCreatingPair] = useState(false)
  const [isAddingLiquidity, setIsAddingLiquidity] = useState(false)
  const [isSwapping, setIsSwapping] = useState(false)
  const [isRemovingLiquidity, setIsRemovingLiquidity] = useState(false)

  // API Base URL - adjust this to your backend URL
  const API_BASE = "http://localhost:3000"

  const [poolsWithLiveData, setPoolsWithLiveData] = useState<PoolWithLiveReserves[]>([])
  const [isLoadingLiveReserves, setIsLoadingLiveReserves] = useState(false)

  const [userPositions, setUserPositions] = useState<{ [poolId: string]: UserLPPosition }>({})
  const [loadingUserPosition, setLoadingUserPosition] = useState(false)
  const [loadingPoolDetails, setLoadingPoolDetails] = useState(false)

  // ---------- Connect ----------
  const connectWallet = async () => {
    const eth = (window as any).ethereum
    if (!eth) return alert("Install MetaMask!")
    const prov = new ethers.BrowserProvider(eth)
    const accounts = await prov.send("eth_requestAccounts", [])
    setAccount(accounts[0])
    setProvider(prov)
    setSigner(await prov.getSigner())
  }

  const fetchLiveReservesForPool = async (pool: Pool): Promise<PoolWithLiveReserves> => {
    if (!signer) {
      return {
        ...pool,
        liveReserves: {
          reserveA: "0",
          reserveB: "0",
          reserveAFormatted: 0,
          reserveBFormatted: 0,
          lastUpdated: new Date(),
          isLoading: false,
          error: "No signer available",
        },
      }
    }

    try {
      // Get the AMM contract instance
      const ammContract = getAMM(pool.address)

      // Fetch live data from blockchain
      const { tokenA, tokenB, reserveA, reserveB } = await getAMMData(ammContract)

      // Get token decimals for proper formatting
      const tokenADecimals =
        typeof pool.tokenA.decimals === "string" ? Number.parseInt(pool.tokenA.decimals) : pool.tokenA.decimals
      const tokenBDecimals =
        typeof pool.tokenB.decimals === "string" ? Number.parseInt(pool.tokenB.decimals) : pool.tokenB.decimals

      // Format the reserves
      const reserveAFormatted = Number.parseFloat(ethers.formatUnits(reserveA, tokenADecimals))
      const reserveBFormatted = Number.parseFloat(ethers.formatUnits(reserveB, tokenBDecimals))

      return {
        ...pool,
        liveReserves: {
          reserveA: reserveA.toString(),
          reserveB: reserveB.toString(),
          reserveAFormatted,
          reserveBFormatted,
          lastUpdated: new Date(),
          isLoading: false,
        },
      }
    } catch (error) {
      console.error(`Error fetching live reserves for pool ${pool.id}:`, error)
      return {
        ...pool,
        liveReserves: {
          reserveA: "0",
          reserveB: "0",
          reserveAFormatted: 0,
          reserveBFormatted: 0,
          lastUpdated: new Date(),
          isLoading: false,
          error: error instanceof Error ? error.message : "Failed to fetch reserves",
        },
      }
    }
  }

  const fetchLiveReservesForAllPools = async (poolsData: Pool[]) => {
    if (!signer || poolsData.length === 0) return

    setIsLoadingLiveReserves(true)

    try {
      // Fetch reserves for all pools in parallel (but limit concurrency to avoid RPC limits)
      const batchSize = 5 // Process 5 pools at a time
      const results: PoolWithLiveReserves[] = []

      for (let i = 0; i < poolsData.length; i += batchSize) {
        const batch = poolsData.slice(i, i + batchSize)
        const batchPromises = batch.map((pool) => fetchLiveReservesForPool(pool))
        const batchResults = await Promise.all(batchPromises)
        results.push(...batchResults)

        // Small delay between batches to be nice to the RPC
        if (i + batchSize < poolsData.length) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }

      setPoolsWithLiveData(results)
    } catch (error) {
      console.error("Error fetching live reserves for pools:", error)
      // Fallback to pools without live data
      setPoolsWithLiveData(poolsData.map((pool) => ({ ...pool })))
    } finally {
      setIsLoadingLiveReserves(false)
    }
  }

  const fetchPoolsWithLiveData = async () => {
    setLoadingPools(true)
    try {
      // First fetch pools from API
      const response = await fetch(`${API_BASE}/pools`)
      if (!response.ok) throw new Error("Failed to fetch pools")
      const poolsData = await response.json()
      setPools(poolsData)

      // Then fetch live reserves for each pool
      await fetchLiveReservesForAllPools(poolsData)
    } catch (error) {
      console.error("Error fetching pools:", error)
      alert("Failed to fetch pools from API")
    } finally {
      setLoadingPools(false)
    }
  }

  const refreshLiveReservesOnly = async () => {
    if (pools.length === 0) return
    await fetchLiveReservesForAllPools(pools)
  }

  // Calculate pool metrics (handle both string and number decimals)
  const getPoolMetrics = (pool: Pool) => {
    const tokenADecimals =
      typeof pool.tokenA.decimals === "string" ? Number.parseInt(pool.tokenA.decimals) : pool.tokenA.decimals
    const tokenBDecimals =
      typeof pool.tokenB.decimals === "string" ? Number.parseInt(pool.tokenB.decimals) : pool.tokenB.decimals

    const reserveA = pool.liquidity.reduce((acc, l) => {
      const amount = Number.parseFloat(l.amountA)
      return acc + (isNaN(amount) ? 0 : amount)
    }, 0)

    const reserveB = pool.liquidity.reduce((acc, l) => {
      const amount = Number.parseFloat(l.amountB)
      return acc + (isNaN(amount) ? 0 : amount)
    }, 0)

    const totalSwaps = pool.swaps?.length || 0

    return {
      reserveA: reserveA / Math.pow(10, tokenADecimals),
      reserveB: reserveB / Math.pow(10, tokenBDecimals),
      totalSwaps,
      pairName: `${pool.tokenA.symbol}/${pool.tokenB.symbol}`,
    }
  }

  const getPoolMetricsWithLiveData = (pool: PoolWithLiveReserves) => {
    // Use live reserves if available, otherwise fall back to database calculation
    if (pool.liveReserves && !pool.liveReserves.error) {
      const totalSwaps = pool.swaps?.length || 0

      return {
        reserveA: pool.liveReserves.reserveAFormatted,
        reserveB: pool.liveReserves.reserveBFormatted,
        totalSwaps,
        pairName: `${pool.tokenA.symbol}/${pool.tokenB.symbol}`,
        isLive: true,
        lastUpdated: pool.liveReserves.lastUpdated,
        error: pool.liveReserves.error,
      }
    } else {
      // Fallback to original database calculation
      const tokenADecimals =
        typeof pool.tokenA.decimals === "string" ? Number.parseInt(pool.tokenA.decimals) : pool.tokenA.decimals
      const tokenBDecimals =
        typeof pool.tokenB.decimals === "string" ? Number.parseInt(pool.tokenB.decimals) : pool.tokenB.decimals

      const reserveA = pool.liquidity.reduce((acc, l) => {
        const amount = Number.parseFloat(l.amountA)
        return acc + (isNaN(amount) ? 0 : amount)
      }, 0)

      const reserveB = pool.liquidity.reduce((acc, l) => {
        const amount = Number.parseFloat(l.amountB)
        return acc + (isNaN(amount) ? 0 : amount)
      }, 0)

      const totalSwaps = pool.swaps?.length || 0

      return {
        reserveA: reserveA / Math.pow(10, tokenADecimals),
        reserveB: reserveB / Math.pow(10, tokenBDecimals),
        totalSwaps,
        pairName: `${pool.tokenA.symbol}/${pool.tokenB.symbol}`,
        isLive: false,
        error: pool.liveReserves?.error,
      }
    }
  }

  useEffect(() => {
    if (!showPools || !signer) return

    const interval = setInterval(refreshLiveReservesOnly, 30000) // 30 seconds

    return () => clearInterval(interval)
  }, [showPools, signer, pools])

  // Helpers to get contracts
  const getFactory = () => new ethers.Contract(CONTRACTS.factory, factoryAbi, signer!)
  const getRouter = () => new ethers.Contract(CONTRACTS.router, routerAbi, signer!)
  const getERC20 = (addr: string) => new ethers.Contract(addr, erc20Abi, signer!)
  const getAMM = (addr: string) => new ethers.Contract(addr, ammAbi, signer!)

  // Helper function to get AMM contract data
  const getAMMData = async (ammContract: ethers.Contract) => {
    try {
      const [token0, token1, reserve0, reserve1] = await Promise.all([
        ammContract.token0(),
        ammContract.token1(),
        ammContract.reserve0(),
        ammContract.reserve1(),
      ])

      return {
        tokenA: token0,
        tokenB: token1,
        reserveA: reserve0,
        reserveB: reserve1,
      }
    } catch (error) {
      console.error("Error getting AMM data:", error)
      throw new Error("Could not get AMM contract data. Check your AMM ABI and contract implementation.")
    }
  }

  // Improved error message decoder
  const decodeContractError = (error: any): string => {
    // Common error messages
    const errorMappings: Record<string, string> = {
      "0xe450d38c": "Insufficient A Amount - Try reducing amount A",
      "0x025dbdd4": "Insufficient B Amount - Try reducing amount B",
      "0x8c379a00": "Contract execution failed",
      "0x4e487b71": "Arithmetic overflow/underflow",
    }

    if (error.reason) {
      return error.reason
    }

    if (error.data && typeof error.data === "string") {
      const errorSig = error.data.slice(0, 10)
      const knownError = errorMappings[errorSig]
      if (knownError) return knownError
    }

    if (error.message) {
      if (error.message.includes("insufficient funds")) {
        return "Insufficient ETH for gas fees"
      }
      if (error.message.includes("execution reverted")) {
        return "Transaction reverted - check token balances and allowances"
      }
      if (error.message.includes("user rejected")) {
        return "Transaction cancelled by user"
      }
      return error.message
    }

    return "Unknown error occurred"
  }

  // =========================================================
  //                    ENHANCED SWAP SECTION
  // =========================================================
  const [swSell, setSwSell] = useState(TOKEN_LIST[0].address)
  const [swBuy, setSwBuy] = useState(TOKEN_LIST[1].address)
  const [swSellAmt, setSwSellAmt] = useState<string>("")
  const [swBuyEst, setSwBuyEst] = useState<string>("")
  const [swDecSell, setSwDecSell] = useState<number>(18)
  const [swDecBuy, setSwDecBuy] = useState<number>(18)
  const [swSlippageBps, setSwSlippageBps] = useState<number>(100)

  // New states for routing
  const [routingData, setRoutingData] = useState<any>(null)
  const [selectedPath, setSelectedPath] = useState<"direct" | "optimal">("optimal")
  const [isLoadingRoute, setIsLoadingRoute] = useState(false)
  const [showAllPaths, setShowAllPaths] = useState(false)
  const [allPaths, setAllPaths] = useState<any[]>([])

  const refreshSwapDecimals = async () => {
    if (!signer) return
    try {
      const dIn = await getERC20(swSell).decimals()
      const dOut = await getERC20(swBuy).decimals()
      setSwDecSell(Number(dIn))
      setSwDecBuy(Number(dOut))
    } catch (error) {
      console.error("Error refreshing swap decimals:", error)
    }
  }

  useEffect(() => {
    refreshSwapDecimals().catch(() => {})
  }, [signer, swSell, swBuy])

  // Enhanced quote function using backend routing
  const quoteSwap = async () => {
    if (!signer || !swSellAmt || swSell === swBuy) {
      setSwBuyEst("")
      setRoutingData(null)
      return
    }

    setIsLoadingRoute(true)
    try {
      const amountIn = ethers.parseUnits(swSellAmt, swDecSell)

      // Get optimal path from backend
      const pathResponse = await fetch(`${API_BASE}/optimal-path/${swSell}/${swBuy}?amount=${amountIn.toString()}`)

      if (!pathResponse.ok) {
        throw new Error("Failed to get optimal path")
      }

      const pathData = await pathResponse.json()
      setRoutingData(pathData)

      // Set the estimated output based on selected path
      const selectedPathData = selectedPath === "direct" ? pathData.direct : pathData.optimal
      if (selectedPathData) {
        setSwBuyEst(ethers.formatUnits(selectedPathData.expectedOutput, swDecBuy))
      } else {
        setSwBuyEst("")
      }
    } catch (error) {
      console.error("Quote swap error:", error)
      setSwBuyEst("")
      setRoutingData(null)

      // Fallback to direct router quote
      try {
        const amountIn = ethers.parseUnits(swSellAmt, swDecSell)
        const router = getRouter()
        const amounts: bigint[] = await router.getAmountsOut(amountIn, [swSell, swBuy])
        const out = amounts[amounts.length - 1]
        setSwBuyEst(ethers.formatUnits(out, swDecBuy))
      } catch (fallbackError) {
        console.error("Fallback quote also failed:", fallbackError)
        setSwBuyEst("")
      }
    } finally {
      setIsLoadingRoute(false)
    }
  }

  // Load all paths for comparison
  const loadAllPaths = async () => {
    if (!swSellAmt || swSell === swBuy) return

    try {
      const response = await fetch(`${API_BASE}/all-paths/${swSell}/${swBuy}?maxHops=3`)
      if (!response.ok) throw new Error("Failed to get all paths")
      const data = await response.json()
      setAllPaths(data.paths || [])
    } catch (error) {
      console.error("Error loading all paths:", error)
      setAllPaths([])
    }
  }

  useEffect(() => {
    quoteSwap().catch(() => {})
  }, [swSell, swBuy, swSellAmt, swDecSell, swDecBuy, selectedPath])

  // Enhanced swap function with multi-hop support
  const doSwap = async () => {
    if (!signer) return
    if (!swSellAmt) return alert("Enter sell amount")
    if (swSell === swBuy) return alert("Select different tokens")

    setIsSwapping(true)
    try {
      const amountIn = ethers.parseUnits(swSellAmt, swDecSell)
      const router = getRouter()

      // Get the selected path data
      const pathData = routingData?.[selectedPath]
      if (!pathData) {
        throw new Error("No valid path found for swap")
      }

      const swapPath = pathData.path
      const expectedOut = BigInt(pathData.expectedOutput)
      const minOut = (expectedOut * BigInt(10000 - swSlippageBps)) / 10000n

      // Approve router for the input token
      const sellToken = getERC20(swSell)
      const currentAllowance = await sellToken.allowance(account, CONTRACTS.router)

      if (currentAllowance < amountIn) {
        const approveTx = await sellToken.approve(CONTRACTS.router, amountIn)
        await approveTx.wait()
      }

      const deadline = Math.floor(Date.now() / 1000) + 600

      let tx
      if (swapPath.length === 2) {
        // Direct swap
        tx = await router.swapExactTokensForTokens(amountIn, minOut, swapPath, account, deadline)
      } else {
        // Multi-hop swap - use the same function but with longer path
        tx = await router.swapExactTokensForTokens(amountIn, minOut, swapPath, account, deadline)
      }

      await tx.wait()

      alert(`✅ Swap completed via ${swapPath.length - 1} hop${swapPath.length > 2 ? "s" : ""}`)
      setSwSellAmt("")
      setSwBuyEst("")
      setRoutingData(null)
      setTimeout(() => fetchPools(), 2000)
    } catch (error: any) {
      console.error("Swap error:", error)
      alert(`Error swapping: ${decodeContractError(error)}`)
    } finally {
      setIsSwapping(false)
    }
  }

  const flipSwap = () => {
    setSwSell(swBuy)
    setSwBuy(swSell)
    setSwSellAmt("")
    setSwBuyEst("")
    setRoutingData(null)
    setAllPaths([])
  }

  // Helper to format token symbols from addresses
  const getTokenSymbol = (address: string) => {
    return (
      TOKEN_LIST.find((t) => t.address.toLowerCase() === address.toLowerCase())?.symbol || address.slice(0, 6) + "..."
    )
  }

  // =========================================================
  //                       REMOVE LIQUIDITY
  // =========================================================
  const [rlTokenA, setRlTokenA] = useState(TOKEN_LIST[0].address)
  const [rlTokenB, setRlTokenB] = useState(TOKEN_LIST[1].address)
  const [rlPair, setRlPair] = useState<string>("")
  const [rlLpAmt, setRlLpAmt] = useState<string>("")

  const refreshRlPair = async () => {
    if (!signer) return
    try {
      const p = await getFactory().getPair(rlTokenA, rlTokenB)
      setRlPair(p)
    } catch (error) {
      console.error("Error refreshing RL pair:", error)
    }
  }

  useEffect(() => {
    refreshRlPair().catch(() => {})
  }, [signer, rlTokenA, rlTokenB])

  const doRemoveLiquidity = async () => {
    if (!signer) return
    if (isZeroAddr(rlPair)) return alert("Pair not found")
    if (!rlLpAmt) return alert("Enter LP amount")

    setIsRemovingLiquidity(true)
    try {
      const amt = ethers.parseUnits(rlLpAmt, 18)

      // Try router removeLiquidity first
      try {
        const router = getRouter()
        const deadline = Math.floor(Date.now() / 1000) + 600

        const pairContract = getAMM(rlPair)
        await (await pairContract.approve(CONTRACTS.router, amt)).wait()

        const tx = await router.removeLiquidity(
          rlTokenA,
          rlTokenB,
          amt,
          0, // minAmountA
          0, // minAmountB
          account,
          deadline,
        )
        await tx.wait()
      } catch (routerError) {
        console.log("Router removeLiquidity failed, trying direct method:", routerError)
        await (await getAMM(rlPair).removeLiquidity(amt)).wait()
      }

      alert("✅ Liquidity removed")
      setRlLpAmt("")
      await refreshRlPair()
      setTimeout(() => fetchPools(), 2000)
    } catch (error: any) {
      console.error("Remove liquidity error:", error)
      alert(`Error removing liquidity: ${decodeContractError(error)}`)
    } finally {
      setIsRemovingLiquidity(false)
    }
  }

  // =========================================================
  //                           UI
  // =========================================================
  const labelFor = (addr: string) => TOKEN_LIST.find((t) => t.address === addr)?.symbol ?? addr.slice(0, 6)

  const [poolTokenA, setPoolTokenA] = useState(TOKEN_LIST[0].address)
  const [poolTokenB, setPoolTokenB] = useState(TOKEN_LIST[1].address)
  const [isCreatingPool, setIsCreatingPool] = useState(false)

  const [liqTokenA, setLiqTokenA] = useState(TOKEN_LIST[0].address)
  const [liqTokenB, setLiqTokenB] = useState(TOKEN_LIST[1].address)
  const [liqAmtA, setLiqAmtA] = useState("")
  const [liqAmtB, setLiqAmtB] = useState("")

  const createPool = async () => {
    if (!signer) return
    if (poolTokenA === poolTokenB) return alert("Select 2 different tokens")

    setIsCreatingPool(true)
    try {
      const f = getFactory()
      const existing = await f.getPair(poolTokenA, poolTokenB)
      if (!isZeroAddr(existing)) {
        alert(`Pair already exists: ${existing}`)
        return
      }
      const tx = await f.createPair(poolTokenA, poolTokenB)
      await tx.wait()
      alert(`✅ Pool created!`)

      // Refresh pools after creating new pool
      setTimeout(() => fetchPools(), 2000)
    } catch (error: any) {
      console.error("Create pool error:", error)
      alert(`Error creating pool: ${decodeContractError(error)}`)
    } finally {
      setIsCreatingPool(false)
    }
  }

  const addLiquidity = async () => {
    if (!signer) return
    if (!liqAmtA || !liqAmtB) return alert("Enter both amounts")
    if (liqTokenA === liqTokenB) return alert("Select different tokens")

    setIsAddingLiquidity(true)
    try {
      const amountADesired = ethers.parseUnits(liqAmtA, 18)
      const amountBDesired = ethers.parseUnits(liqAmtB, 18)

      const router = getRouter()
      const tokenAContract = getERC20(liqTokenA)
      const tokenBContract = getERC20(liqTokenB)

      // Check current balances
      const [balanceA, balanceB] = await Promise.all([
        tokenAContract.balanceOf(account),
        tokenBContract.balanceOf(account),
      ])

      // Check if user has enough balance
      if (balanceA < amountADesired) {
        throw new Error(
          `Insufficient ${labelFor(liqTokenA)} balance. Required: ${ethers.formatUnits(amountADesired, 18)}, Available: ${ethers.formatUnits(balanceA, 18)}`,
        )
      }

      if (balanceB < amountBDesired) {
        throw new Error(
          `Insufficient ${labelFor(liqTokenB)} balance. Required: ${ethers.formatUnits(amountBDesired, 18)}, Available: ${ethers.formatUnits(balanceB, 18)}`,
        )
      }

      // Check and approve if needed
      const [allowanceA, allowanceB] = await Promise.all([
        tokenAContract.allowance(account, CONTRACTS.router),
        tokenBContract.allowance(account, CONTRACTS.router),
      ])

      if (allowanceA < amountADesired) {
        const approveTxA = await tokenAContract.approve(CONTRACTS.router, amountADesired)
        await approveTxA.wait()
      }

      if (allowanceB < amountBDesired) {
        const approveTxB = await tokenBContract.approve(CONTRACTS.router, amountBDesired)
        await approveTxB.wait()
      }

      // Calculate minimum amounts (0.5% slippage tolerance)
      const minAmountA = (amountADesired * 995n) / 1000n
      const minAmountB = (amountBDesired * 995n) / 1000n
      const deadline = Math.floor(Date.now() / 1000) + 600

      // Estimate gas first
      await router.addLiquidity.estimateGas(
        liqTokenA,
        liqTokenB,
        amountADesired,
        amountBDesired,
        minAmountA,
        minAmountB,
        account,
        deadline,
      )

      const tx = await router.addLiquidity(
        liqTokenA,
        liqTokenB,
        amountADesired,
        amountBDesired,
        minAmountA,
        minAmountB,
        account,
        deadline,
      )

      await tx.wait()
      alert("✅ Liquidity added successfully!")

      // Refresh UI
      setTimeout(() => fetchPools(), 2000)
    } catch (error: any) {
      console.error("AddLiquidity error:", error)
      alert(`Error adding liquidity: ${decodeContractError(error)}`)
    } finally {
      setIsAddingLiquidity(false)
    }
  }

  const fetchUserLPPosition = async (poolId: string, pairAddress: string): Promise<UserLPPosition | null> => {
    if (!account || !provider) {
      console.log("[v0] No account or provider for LP position")
      return null
    }

    try {
      console.log("[v0] Fetching LP position for pool:", poolId, "pair:", pairAddress)
      const pairContract = new ethers.Contract(pairAddress, AMMPairABI, provider)

      // Get user's LP token balance
      const lpBalance = await pairContract.balanceOf(account)
      console.log("[v0] User LP balance:", lpBalance.toString())

      // Get total supply of LP tokens
      const totalSupply = await pairContract.totalSupply()
      console.log("[v0] Total LP supply:", totalSupply.toString())

      // Calculate share percentage
      const sharePercentage =
        totalSupply.toString() === "0"
          ? 0
          : (Number(ethers.formatEther(lpBalance)) / Number(ethers.formatEther(totalSupply))) * 100

      console.log("[v0] Share percentage:", sharePercentage)

      // Get current reserves to calculate user's share
      const reserves = await pairContract.getReserves()
      console.log("[v0] Current reserves:", reserves[0].toString(), reserves[1].toString())

      const reserve0 = Number(ethers.formatEther(reserves[0]))
      const reserve1 = Number(ethers.formatEther(reserves[1]))

      const shareOfReserveA = (sharePercentage / 100) * reserve0
      const shareOfReserveB = (sharePercentage / 100) * reserve1

      const result = {
        lpBalance: ethers.formatEther(lpBalance),
        sharePercentage,
        shareOfReserveA,
        shareOfReserveB,
      }

      console.log("[v0] LP position result:", result)
      return result
    } catch (error) {
      console.error("[v0] Error fetching user LP position:", error)
      return null
    }
  }

  const fetchPoolDetails = async (poolId: string) => {
    console.log("[v0] Fetching pool details for:", poolId)
    setLoadingPoolDetails(true)
    setLoadingUserPosition(true)

    try {
      const response = await fetch(`${API_BASE}/pools/${poolId}`)
      if (!response.ok) throw new Error("Failed to fetch pool details")

      const poolData = await response.json()
      console.log("[v0] Pool data received:", poolData)
      setSelectedPool(poolData)

      if (account && poolData.address && poolData.address !== ethers.ZeroAddress) {
        console.log("[v0] Fetching user position for connected account")
        const userPosition = await fetchUserLPPosition(poolId, poolData.address)
        if (userPosition) {
          console.log("[v0] Setting user position:", userPosition)
          setUserPositions((prev) => ({
            ...prev,
            [poolId]: userPosition,
          }))
        } else {
          console.log("[v0] No user position found")
        }
      } else {
        console.log("[v0] Skipping user position fetch - account:", !!account, "address:", poolData.address)
      }
    } catch (error) {
      console.error("[v0] Error fetching pool details:", error)
    } finally {
      setLoadingPoolDetails(false)
      setLoadingUserPosition(false)
    }
  }

  const fetchPools = async () => {
    // Implementation for fetchPools
    console.log("Fetching pools...")
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-6xl mx-auto p-6 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-r from-pink-500 to-purple-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">S</span>
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
              SwapLiT
            </h1>
          </div>
          <div className="flex gap-4">
            <button
              onClick={() => {
                setShowPools(!showPools)
                if (!showPools) fetchPoolsWithLiveData()
              }}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-xl border border-gray-700 transition-all duration-200 hover:border-pink-500"
            >
              {showPools ? "Hide Pools" : "View Pools"}
            </button>
            <button
              onClick={connectWallet}
              className="px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-xl shadow-lg transition-all duration-200"
            >
              {account ? `Connected: ${account.slice(0, 6)}…` : "Connect Wallet"}
            </button>
          </div>
        </div>

        {showPools && (
          <section className="bg-gray-800 border border-gray-700 rounded-2xl p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white">Pool Analytics</h2>
              <div className="flex gap-2">
                <button
                  onClick={refreshLiveReservesOnly}
                  disabled={isLoadingLiveReserves}
                  className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl transition-colors disabled:opacity-50 text-sm"
                  title="Refresh live reserves"
                >
                  {isLoadingLiveReserves ? "Updating..." : "🔄 Live Data"}
                </button>
                <button
                  onClick={fetchPoolsWithLiveData}
                  disabled={loadingPools}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loadingPools ? "Loading..." : "Refresh All"}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                {signer && (
                  <div className="flex items-center gap-1">
                    <div
                      className={`w-2 h-2 rounded-full ${isLoadingLiveReserves ? "bg-yellow-500 animate-pulse" : "bg-green-500"}`}
                    ></div>
                    <span className="text-gray-300">
                      {isLoadingLiveReserves ? "Updating live data..." : "Live reserves active"}
                    </span>
                  </div>
                )}
              </div>
              <div className="text-gray-400">
                {poolsWithLiveData.length > 0
                  ? `${poolsWithLiveData.filter((p) => p.liveReserves && !p.liveReserves.error).length}/${poolsWithLiveData.length} pools with live data`
                  : "Using database reserves"}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(poolsWithLiveData.length > 0 ? poolsWithLiveData : pools).map((pool) => {
                const metrics = getPoolMetricsWithLiveData(pool as PoolWithLiveReserves)
                const isLiveDataAvailable = "liveReserves" in pool && pool.liveReserves && !pool.liveReserves.error

                return (
                  <div
                    key={pool.id}
                    className="bg-gray-900 border border-gray-700 rounded-xl p-4 shadow-md hover:shadow-lg transition-shadow cursor-pointer relative"
                    onClick={() => fetchPoolDetails(pool.id)}
                  >
                    <div className="absolute top-2 right-2">
                      {isLiveDataAvailable ? (
                        <div className="flex items-center gap-1 text-xs text-green-400 bg-green-900/30 px-2 py-1 rounded-full border border-green-500/30">
                          <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                          LIVE
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-xs text-gray-400 bg-gray-800/50 px-2 py-1 rounded-full border border-gray-600/30">
                          <div className="w-1.5 h-1.5 bg-gray-500 rounded-full"></div>
                          DB
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between mb-3 pr-12">
                      <h3 className="text-lg font-semibold text-white">{metrics.pairName}</h3>
                      <span className="text-sm text-gray-400">#{pool.id}</span>
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-300">Reserve {pool.tokenA.symbol}:</span>
                        <span className="font-medium text-gray-200">{metrics.reserveA.toFixed(4)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-300">Reserve {pool.tokenB.symbol}:</span>
                        <span className="font-medium text-gray-200">{metrics.reserveB.toFixed(4)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-300">Total Swaps:</span>
                        <span className="font-medium text-gray-200">{metrics.totalSwaps}</span>
                      </div>

                      {isLiveDataAvailable && "lastUpdated" in metrics && (
                        <div className="text-xs text-gray-500 pt-1 border-t border-gray-700">
                          Updated: {metrics.lastUpdated.toLocaleTimeString()}
                        </div>
                      )}

                      {metrics.error && (
                        <div className="text-xs text-red-400 pt-1 border-t border-red-800">Error: {metrics.error}</div>
                      )}
                    </div>

                    <div className="mt-3 pt-3 border-t border-gray-700">
                      <p className="text-xs text-gray-500 truncate">
                        Contract: {pool.address.slice(0, 8)}...{pool.address.slice(-6)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>

            {selectedPool && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                <div className="bg-gray-800 rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-gray-700">
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold text-white">Pool Details</h2>
                    <button
                      onClick={() => setSelectedPool(null)}
                      className="text-gray-400 hover:text-white text-2xl transition-colors"
                    >
                      ×
                    </button>
                  </div>

                  {/* Pool Info */}
                  <div className="space-y-6">
                    {account && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-lg font-semibold text-gray-200">Your Position</h3>
                          {loadingUserPosition && <div className="text-xs text-gray-400">Loading position...</div>}
                        </div>

                        {userPositions[selectedPool.id] ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-gradient-to-r from-pink-900/20 to-purple-900/20 border border-pink-500/20 rounded-lg p-4">
                              <div className="text-sm text-gray-400 mb-1">LP Tokens</div>
                              <div className="text-xl font-bold text-pink-400">
                                {Number(userPositions[selectedPool.id].lpBalance).toFixed(6)}
                              </div>
                              <div className="text-xs text-gray-500 mt-1">
                                {userPositions[selectedPool.id].sharePercentage.toFixed(4)}% of pool
                              </div>
                            </div>

                            <div className="bg-gradient-to-r from-purple-900/20 to-blue-900/20 border border-purple-500/20 rounded-lg p-4">
                              <div className="text-sm text-gray-400 mb-1">Your Share</div>
                              <div className="space-y-1">
                                <div className="text-sm text-purple-300">
                                  {userPositions[selectedPool.id].shareOfReserveA.toFixed(4)}{" "}
                                  {selectedPool.tokenA.symbol}
                                </div>
                                <div className="text-sm text-blue-300">
                                  {userPositions[selectedPool.id].shareOfReserveB.toFixed(4)}{" "}
                                  {selectedPool.tokenB.symbol}
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          !loadingUserPosition && (
                            <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4 text-center">
                              <div className="text-gray-400">No liquidity position found</div>
                              <div className="text-xs text-gray-500 mt-1">
                                Add liquidity to this pool to see your position
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    )}

                    {!account && (
                      <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4 text-center">
                        <div className="text-gray-400">Connect wallet to view your position</div>
                      </div>
                    )}

                    <div>
                      <h3 className="text-lg font-semibold text-gray-200 mb-3">Token Information</h3>
                      <div className="space-y-3">
                        <div className="bg-gray-900 border border-pink-500/20 rounded-lg p-4">
                          <div className="font-medium text-pink-400">{selectedPool.tokenA.symbol}</div>
                          <div className="text-sm text-gray-300">{selectedPool.tokenA.name || "N/A"}</div>
                          <div className="text-xs text-gray-500 font-mono">{selectedPool.tokenA.address}</div>
                          <div className="text-xs text-gray-500">Decimals: {selectedPool.tokenA.decimals}</div>
                        </div>
                        <div className="bg-gray-900 border border-purple-500/20 rounded-lg p-4">
                          <div className="font-medium text-purple-400">{selectedPool.tokenB.symbol}</div>
                          <div className="text-sm text-gray-300">{selectedPool.tokenB.name || "N/A"}</div>
                          <div className="text-xs text-gray-500 font-mono">{selectedPool.tokenB.address}</div>
                          <div className="text-xs text-gray-500">Decimals: {selectedPool.tokenB.decimals}</div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-gray-200">Current Reserves & Metrics</h3>
                        {(() => {
                          const poolWithLive = poolsWithLiveData.find((p) => p.id === selectedPool.id)
                          const isLive = poolWithLive?.liveReserves && !poolWithLive.liveReserves.error
                          return (
                            <div className="flex items-center gap-2">
                              {isLive ? (
                                <div className="flex items-center gap-1 text-xs text-green-400 bg-green-900/30 px-2 py-1 rounded-full border border-green-500/30">
                                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                                  LIVE BLOCKCHAIN DATA
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 text-xs text-gray-400 bg-gray-800/50 px-2 py-1 rounded-full border border-gray-600/30">
                                  <div className="w-1.5 h-1.5 bg-gray-500 rounded-full"></div>
                                  DATABASE DATA
                                </div>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {(() => {
                          const poolWithLive = poolsWithLiveData.find((p) => p.id === selectedPool.id)
                          const metrics = getPoolMetricsWithLiveData(
                            poolWithLive || (selectedPool as PoolWithLiveReserves),
                          )

                          return (
                            <>
                              <div className="bg-gray-900 border border-green-500/20 rounded-lg p-4 text-center">
                                <div className="text-2xl font-bold text-green-400">{metrics.reserveA.toFixed(4)}</div>
                                <div className="text-green-300">{selectedPool.tokenA.symbol} Reserve</div>
                                {metrics.isLive && (
                                  <div className="text-xs text-green-500 mt-1">
                                    Live: {new Date(metrics.lastUpdated).toLocaleTimeString()}
                                  </div>
                                )}
                              </div>
                              <div className="bg-gray-900 border border-blue-500/20 rounded-lg p-4 text-center">
                                <div className="text-2xl font-bold text-blue-400">{metrics.reserveB.toFixed(4)}</div>
                                <div className="text-blue-300">{selectedPool.tokenB.symbol} Reserve</div>
                                {metrics.isLive && (
                                  <div className="text-xs text-blue-500 mt-1">
                                    Live: {new Date(metrics.lastUpdated).toLocaleTimeString()}
                                  </div>
                                )}
                              </div>
                              <div className="bg-gray-900 border border-purple-500/20 rounded-lg p-4 text-center">
                                <div className="text-2xl font-bold text-purple-400">{metrics.totalSwaps}</div>
                                <div className="text-purple-300">Total Swaps</div>
                              </div>
                            </>
                          )
                        })()}
                      </div>
                    </div>

                    {/* Recent Swaps */}
                    {selectedPool.swaps && selectedPool.swaps.length > 0 && (
                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-gray-200">Recent Swaps</h3>
                        <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
                          <div className="max-h-60 overflow-y-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-gray-800 sticky top-0">
                                <tr>
                                  <th className="text-left p-3 text-gray-400">Trader</th>
                                  <th className="text-left p-3 text-gray-400">Token In</th>
                                  <th className="text-left p-3 text-gray-400">Amount In</th>
                                  <th className="text-left p-3 text-gray-400">Token Out</th>
                                  <th className="text-left p-3 text-gray-400">Amount Out</th>
                                  <th className="text-left p-3 text-gray-400">Time</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedPool.swaps.map((swap, index) => (
                                  <tr key={index} className="border-t border-gray-700">
                                    <td className="p-3 font-mono text-xs text-gray-500">
                                      {swap.trader.slice(0, 6)}...{swap.trader.slice(-4)}
                                    </td>
                                    <td className="p-3 text-gray-300">
                                      {swap.tokenIn === "token0"
                                        ? selectedPool.tokenA.symbol
                                        : selectedPool.tokenB.symbol}
                                    </td>
                                    <td className="p-3 text-gray-300">
                                      {Number.parseFloat(swap.amountIn as string) /
                                        Math.pow(
                                          10,
                                          swap.tokenIn === "token0"
                                            ? Number(selectedPool.tokenA.decimals)
                                            : Number(selectedPool.tokenB.decimals),
                                        )}
                                    </td>
                                    <td className="p-3 text-gray-300">
                                      {swap.tokenOut === "token0"
                                        ? selectedPool.tokenA.symbol
                                        : selectedPool.tokenB.symbol}
                                    </td>
                                    <td className="p-3 text-gray-300">
                                      {Number.parseFloat(swap.amountOut as string) /
                                        Math.pow(
                                          10,
                                          swap.tokenOut === "token0"
                                            ? Number(selectedPool.tokenA.decimals)
                                            : Number(selectedPool.tokenB.decimals),
                                        )}
                                    </td>
                                    <td className="p-3 text-gray-300">
                                      {new Date(Number(swap.createdAt)).toLocaleString()}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Liquidity History */}
                    {selectedPool.liquidity && selectedPool.liquidity.length > 0 && (
                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-gray-200">Liquidity History</h3>
                        <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
                          <div className="max-h-60 overflow-y-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-gray-800 sticky top-0">
                                <tr>
                                  <th className="text-left p-3 text-gray-400">Provider</th>
                                  <th className="text-left p-3 text-gray-400">Action</th>
                                  <th className="text-left p-3 text-gray-400">{selectedPool.tokenA.symbol}</th>
                                  <th className="text-left p-3 text-gray-400">{selectedPool.tokenB.symbol}</th>
                                  <th className="text-left p-3 text-gray-400">Time</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedPool.liquidity.map((liq, index) => {
                                  const amountA = Number.parseFloat(liq.amountA)
                                  const amountB = Number.parseFloat(liq.amountB)
                                  const isAdd = amountA >= 0 && amountB >= 0

                                  return (
                                    <tr key={index} className="border-t border-gray-700">
                                      <td className="p-3 font-mono text-xs text-gray-500">
                                        {liq.provider.slice(0, 6)}...{liq.provider.slice(-4)}
                                      </td>
                                      <td className="p-3">
                                        <span
                                          className={`px-2 py-1 rounded text-xs ${isAdd ? "bg-green-900/20 text-green-300" : "bg-red-900/20 text-red-300"}`}
                                        >
                                          {isAdd ? "Add" : "Remove"}
                                        </span>
                                      </td>
                                      <td className="p-3 text-gray-300">
                                        {Math.abs(amountA) / Math.pow(10, Number(selectedPool.tokenA.decimals))}
                                      </td>
                                      <td className="p-3 text-gray-300">
                                        {Math.abs(amountB) / Math.pow(10, Number(selectedPool.tokenB.decimals))}
                                      </td>
                                      <td className="p-3 text-gray-300">
                                        {new Date(Number(liq.createdAt)).toLocaleString()}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Create Pool */}
        <section className="bg-gray-800 border border-gray-700 rounded-2xl p-6 space-y-4 shadow-xl">
          <h2 className="font-semibold text-xl text-white">Create New Pool</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <select
              className="bg-gray-900 border border-gray-600 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
              value={poolTokenA}
              onChange={(e) => setPoolTokenA(e.target.value as typeof poolTokenA)}
            >
              {TOKEN_LIST.map((t) => (
                <option key={t.address} value={t.address} className="bg-gray-900">
                  {t.symbol}
                </option>
              ))}
            </select>
            <select
              className="bg-gray-900 border border-gray-600 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
              value={poolTokenB}
              onChange={(e) => setPoolTokenB(e.target.value as typeof poolTokenB)}
            >
              {TOKEN_LIST.map((t) => (
                <option key={t.address} value={t.address} className="bg-gray-900">
                  {t.symbol}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={createPool}
            disabled={isCreatingPool}
            className="w-full px-4 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg"
          >
            {isCreatingPool ? "Creating..." : "Create Pool"}
          </button>
        </section>

        {/* Add Liquidity */}
        <section className="bg-gray-800 border border-gray-700 rounded-2xl p-6 space-y-4 shadow-xl">
          <h2 className="font-semibold text-xl text-white">Add Liquidity</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <select
                className="bg-gray-900 border border-gray-600 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                value={liqTokenA}
                onChange={(e) => setLiqTokenA(e.target.value as typeof liqTokenA)}
              >
                {TOKEN_LIST.map((t) => (
                  <option key={t.address} value={t.address} className="bg-gray-900">
                    {t.symbol}
                  </option>
                ))}
              </select>
              <select
                className="bg-gray-900 border border-gray-600 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                value={liqTokenB}
                onChange={(e) => setLiqTokenB(e.target.value as typeof liqTokenB)}
              >
                {TOKEN_LIST.map((t) => (
                  <option key={t.address} value={t.address} className="bg-gray-900">
                    {t.symbol}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input
                value={liqAmtA}
                onChange={(e) => setLiqAmtA(e.target.value)}
                placeholder={`${getTokenSymbol(liqTokenA)} amount`}
                className="bg-gray-900 border border-gray-600 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent placeholder-gray-400"
              />
              <input
                value={liqAmtB}
                onChange={(e) => setLiqAmtB(e.target.value)}
                placeholder={`${getTokenSymbol(liqTokenB)} amount`}
                className="bg-gray-900 border border-gray-600 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent placeholder-gray-400"
              />
            </div>
          </div>
          <button
            onClick={addLiquidity}
            disabled={isAddingLiquidity}
            className="w-full px-4 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg"
          >
            {isAddingLiquidity ? "Adding..." : "Add Liquidity"}
          </button>
        </section>

        {/* Enhanced Swap */}
        <section className="bg-gray-800 border border-gray-700 rounded-2xl p-6 space-y-4 shadow-xl">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-xl text-white">Advanced Swap</h2>
            {routingData && (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAllPaths(!showAllPaths)}
                  className="text-sm px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors border border-gray-600"
                >
                  {showAllPaths ? "Hide" : "Show"} All Paths
                </button>
                <button
                  onClick={loadAllPaths}
                  className="text-sm px-3 py-2 bg-pink-500/20 hover:bg-pink-500/30 text-pink-300 rounded-lg transition-colors border border-pink-500/30"
                >
                  Analyze Paths
                </button>
              </div>
            )}
          </div>

          {/* Main swap interface */}
          <div className="flex gap-3 items-center">
            <input
              value={swSellAmt}
              onChange={(e) => setSwSellAmt(e.target.value)}
              placeholder="Sell amount"
              className="bg-gray-900 border border-gray-600 text-white px-4 py-3 rounded-xl flex-1 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent placeholder-gray-400"
            />
            <select
              className="bg-gray-900 border border-gray-600 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
              value={swSell}
              onChange={(e) => setSwSell(e.target.value as typeof swSell)}
            >
              {TOKEN_LIST.map((t) => (
                <option key={t.address} value={t.address} className="bg-gray-900">
                  {t.symbol}
                </option>
              ))}
            </select>

            <button
              onClick={flipSwap}
              className="px-4 py-3 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-xl transition-colors font-mono text-white"
              title="Flip tokens"
            >
              ⇄
            </button>

            <input
              value={swBuyEst}
              readOnly
              placeholder={isLoadingRoute ? "Loading..." : "Buy (estimated)"}
              className="bg-gray-900 border border-gray-600 text-gray-300 px-4 py-3 rounded-xl flex-1 placeholder-gray-500"
            />
            <select
              className="bg-gray-900 border border-gray-600 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
              value={swBuy}
              onChange={(e) => setSwBuy(e.target.value as typeof swBuy)}
            >
              {TOKEN_LIST.map((t) => (
                <option key={t.address} value={t.address} className="bg-gray-900">
                  {t.symbol}
                </option>
              ))}
            </select>
          </div>

          {/* Routing options */}
          {routingData && (
            <div className="bg-gray-900 border border-pink-500/20 rounded-xl p-4 space-y-3">
              <h3 className="font-medium text-pink-400">🛣️ Available Routes</h3>

              <div className="space-y-2">
                {routingData.direct && (
                  <label className="flex items-center gap-3 p-3 bg-gray-800 border border-gray-700 rounded-lg cursor-pointer hover:border-pink-500/50 transition-colors">
                    <input
                      type="radio"
                      name="swapPath"
                      value="direct"
                      checked={selectedPath === "direct"}
                      onChange={() => setSelectedPath("direct")}
                      className="text-pink-500 focus:ring-pink-500"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-white">🎯 Direct Path ({routingData.direct.hops} hop)</div>
                      <div className="text-sm text-gray-300">
                        Output: {ethers.formatUnits(routingData.direct.expectedOutput, swDecBuy)}{" "}
                        {getTokenSymbol(swBuy)}
                      </div>
                      <div className="text-xs text-gray-500">
                        Gas: ~{Math.floor(Number(routingData.direct.gasEstimate) / 1000)}k
                      </div>
                    </div>
                  </label>
                )}

                {routingData.optimal && routingData.optimal !== routingData.direct && (
                  <label className="flex items-center gap-3 p-3 bg-gray-800 border border-gray-700 rounded-lg cursor-pointer hover:border-pink-500/50 transition-colors">
                    <input
                      type="radio"
                      name="swapPath"
                      value="optimal"
                      checked={selectedPath === "optimal"}
                      onChange={() => setSelectedPath("optimal")}
                      className="text-pink-500 focus:ring-pink-500"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-white">⚡ Optimal Path ({routingData.optimal.hops} hops)</div>
                      <div className="text-sm text-gray-300">
                        Output: {ethers.formatUnits(routingData.optimal.expectedOutput, swDecBuy)}{" "}
                        {getTokenSymbol(swBuy)}
                      </div>
                      <div className="text-xs text-gray-500">
                        Route: {routingData.optimal.path.map(getTokenSymbol).join(" → ")}
                      </div>
                      <div className="text-xs text-gray-500">
                        Gas: ~{Math.floor(Number(routingData.optimal.gasEstimate) / 1000)}k
                      </div>
                    </div>
                  </label>
                )}
              </div>

              {routingData.optimal && routingData.direct && (
                <div className="text-xs text-green-300 bg-green-500/20 border border-green-500/30 p-3 rounded-lg">
                  💡 Optimal route gives you{" "}
                  {(
                    ((Number(ethers.formatUnits(routingData.optimal.expectedOutput, swDecBuy)) -
                      Number(ethers.formatUnits(routingData.direct.expectedOutput, swDecBuy))) /
                      Number(ethers.formatUnits(routingData.direct.expectedOutput, swDecBuy))) *
                    100
                  ).toFixed(2)}
                  % more tokens!
                </div>
              )}
            </div>
          )}

          {/* All paths analysis */}
          {showAllPaths && allPaths.length > 0 && (
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
              <h3 className="font-medium text-gray-200">📊 All Available Paths</h3>
              <div className="grid gap-2 max-h-48 overflow-y-auto">
                {allPaths.map((pathInfo, index) => (
                  <div key={index} className="bg-gray-800 border border-gray-700 p-3 rounded-lg text-sm">
                    <div className="font-medium text-white">
                      Path {index + 1}: {pathInfo.hops} hop{pathInfo.hops > 1 ? "s" : ""}
                    </div>
                    <div className="text-xs text-gray-400 font-mono">
                      {pathInfo.path.map(getTokenSymbol).join(" → ")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Slippage and controls */}
          <div className="flex items-center justify-between gap-4 text-sm">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2">
                <span className="text-gray-300">Slippage:</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  step={0.1}
                  value={(swSlippageBps / 100).toString()}
                  onChange={(e) => setSwSlippageBps(Math.round(Number(e.target.value) * 100))}
                  className="bg-gray-900 border border-gray-600 text-white px-2 py-1 rounded-lg w-20 focus:outline-none focus:ring-1 focus:ring-pink-500"
                />
                <span className="text-gray-400">%</span>
              </label>

              {routingData && (
                <div className="text-gray-400">
                  Route via {routingData[selectedPath]?.hops || 0} hop
                  {(routingData[selectedPath]?.hops || 0) > 1 ? "s" : ""}
                </div>
              )}
            </div>

            {isLoadingRoute && <div className="text-pink-400 text-sm">🔄 Finding best route...</div>}
          </div>

          {/* Swap button */}
          <button
            onClick={doSwap}
            disabled={isSwapping || isLoadingRoute || !swBuyEst}
            className="w-full px-4 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg"
          >
            {isSwapping
              ? "Swapping..."
              : isLoadingRoute
                ? "Finding Route..."
                : !swBuyEst
                  ? "Enter Amount"
                  : `Swap via ${routingData?.[selectedPath]?.hops || 1} hop${(routingData?.[selectedPath]?.hops || 1) > 1 ? "s" : ""}`}
          </button>
        </section>

        {/* Remove Liquidity */}
        <section className="bg-gray-800 border border-gray-700 rounded-2xl p-6 space-y-4 shadow-xl">
          <h2 className="font-semibold text-xl text-white">Remove Liquidity</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <select
              className="bg-gray-900 border border-gray-600 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
              value={rlTokenA}
              onChange={(e) => setRlTokenA(e.target.value as typeof rlTokenA)}
            >
              {TOKEN_LIST.map((t) => (
                <option key={t.address} value={t.address} className="bg-gray-900">
                  {t.symbol}
                </option>
              ))}
            </select>
            <select
              className="bg-gray-900 border border-gray-600 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
              value={rlTokenB}
              onChange={(e) => setRlTokenB(e.target.value as typeof rlTokenB)}
            >
              {TOKEN_LIST.map((t) => (
                <option key={t.address} value={t.address} className="bg-gray-900">
                  {t.symbol}
                </option>
              ))}
            </select>
            <input
              value={rlLpAmt}
              onChange={(e) => setRlLpAmt(e.target.value)}
              placeholder="LP amount"
              className="bg-gray-900 border border-gray-600 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent placeholder-gray-400"
            />
          </div>
          <div className="text-sm text-gray-400">
            {rlPair && !isZeroAddr(rlPair) ? `Pair: ${rlPair}` : "Pair not found yet."}
          </div>
          <button
            onClick={doRemoveLiquidity}
            disabled={isRemovingLiquidity}
            className="w-full px-4 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg"
          >
            {isRemovingLiquidity ? "Removing..." : "Remove Liquidity"}
          </button>
        </section>
      </div>
    </div>
  )
}
