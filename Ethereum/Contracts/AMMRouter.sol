// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AMM.sol";
import "./AMMFactory.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract AMMRouter is ReentrancyGuard {
    AMMFactory public immutable factory;

    error InvalidPath();
    error InsufficientOutput();
    error PairNotFound();
    error DeadlineExpired();

    constructor(address factory_) {
        factory = AMMFactory(factory_);
    }

    // ---------- Helpers ----------

    function _pairFor(address a, address b) internal view returns (address) {
        address p = factory.getPair(a, b);
        if (p == address(0)) revert PairNotFound();
        return p;
    }

    // ---------- Views ----------

    function getAmountOut(uint256 amountIn, address tokenIn, address tokenOut) public view returns (uint256) {
        address pair = _pairFor(tokenIn, tokenOut);
        return AMM(pair).getQuantityOut(tokenIn, amountIn);
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        public
        view
        returns (uint256[] memory amounts)
    {
        if (path.length < 2) revert InvalidPath();
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 0; i < path.length - 1; i++) {
            amounts[i + 1] = getAmountOut(amounts[i], path[i], path[i + 1]);
        }
    }

    // ---------- Liquidity ----------

    /// @notice Add liquidity through router (mints LP to `to`)
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,     // slippage guard (optional, can be 0)
        uint256 amountBMin,     // slippage guard (optional, can be 0)
        address to,
        uint256 deadline
    ) external nonReentrant returns (uint256 liquidity) {
        if (deadline < block.timestamp) revert DeadlineExpired();

        address pair = factory.getPair(tokenA, tokenB);
        
        // Create pair if it doesn't exist
        if (pair == address(0)) {
            pair = factory.createPair(tokenA, tokenB);
        }

        // Pull tokens from user to router
        IERC20(tokenA).transferFrom(msg.sender, address(this), amountADesired);
        IERC20(tokenB).transferFrom(msg.sender, address(this), amountBDesired);

        // Optional min checks (very basic)
        if (amountADesired < amountAMin || amountBDesired < amountBMin) revert InsufficientOutput();

        // Get the AMM contract to check token ordering
        AMM ammPair = AMM(pair);
        
        // Map tokenA/tokenB to token0/token1 based on AMM's sorting
        (uint256 amount0, uint256 amount1) = tokenA == ammPair.token0() 
            ? (amountADesired, amountBDesired) 
            : (amountBDesired, amountADesired);

        // Approve pair to pull from router (using correct token addresses)
        IERC20(ammPair.token0()).approve(pair, amount0);
        IERC20(ammPair.token1()).approve(pair, amount1);

        // Call AMM with correctly ordered amounts
        liquidity = ammPair.addLiquidity(amount0, amount1);

        // forward LP to user
        uint256 lpBal = ammPair.balanceOf(address(this));
        if (lpBal > 0) {
            ammPair.transfer(to, lpBal);
        }
    }

    /// @notice Remove liquidity via router (burns LP and returns tokens to `to`)
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountA, uint256 amountB) {
        if (deadline < block.timestamp) revert DeadlineExpired();
        address pair = _pairFor(tokenA, tokenB);

        // Pull LP from user
        AMM(pair).transferFrom(msg.sender, address(this), liquidity);

        // Burn LP held by router (returns tokens to router)
        (uint256 amount0, uint256 amount1) = AMM(pair).removeLiquidity(liquidity);

        // Map amounts to correct tokens (AMM uses sorted token0/token1)
        AMM ammContract = AMM(pair);
        (amountA, amountB) = tokenA == ammContract.token0() ? (amount0, amount1) : (amount1, amount0);
        
        // Check slippage
        if (amountA < amountAMin || amountB < amountBMin) revert InsufficientOutput();

        // Send tokens to `to`
        IERC20(tokenA).transfer(to, amountA);
        IERC20(tokenB).transfer(to, amountB);
    }

    // ---------- Swaps ----------

    /// @notice Swap exact amountIn along path; final tokens are sent to `to`
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        if (deadline < block.timestamp) revert DeadlineExpired();
        if (path.length < 2) revert InvalidPath();

        // Pull input from user
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);

        uint256[] memory amounts = getAmountsOut(amountIn, path);
        amountOut = amounts[amounts.length - 1];
        if (amountOut < amountOutMin) revert InsufficientOutput();

        // Hop through each pair
        for (uint256 i = 0; i < path.length - 1; i++) {
            address tokenIn = path[i];
            address tokenOut = path[i + 1];
            address pair = _pairFor(tokenIn, tokenOut);

            // approve and swap; router receives output
            IERC20(tokenIn).approve(pair, amounts[i]);
            AMM(pair).swap(tokenIn, amounts[i]);
        }

        // send final output to user
        IERC20(path[path.length - 1]).transfer(to, amountOut);
    }
}