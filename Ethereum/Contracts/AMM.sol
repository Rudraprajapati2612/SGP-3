// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";


/// @title Simple constant-product AMM Pair (LP token = this ERC20)
contract AMM is ERC20, ReentrancyGuard {
    address public immutable token0; // sorted
    address public immutable token1; // sorted

    uint256 public reserve0; // reserve of token0
    uint256 public reserve1; // reserve of token1

    // ---- Events (so your backend can subscribe) ----
    event Mint(address indexed sender, uint256 amount0, uint256 amount1, uint256 liquidity);
    event Burn(address indexed sender, uint256 liquidity, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        address indexed tokenIn,
        uint256 amountIn,
        address indexed tokenOut,
        uint256 amountOut,
        address to
    );
    event Sync(uint256 reserve0, uint256 reserve1);

    constructor(address _tokenA, address _tokenB) ERC20("AMM-LP", "LP") {
        require(_tokenA != _tokenB, "Identical");
        (address _t0, address _t1) = _tokenA < _tokenB ? (_tokenA, _tokenB) : (_tokenB, _tokenA);
        token0 = _t0;
        token1 = _t1;
    }

    // ---------------- Views ----------------

    function getReserves() external view returns (uint256, uint256) {
        return (reserve0, reserve1);
    }

    /// @notice qty out for input token & amount (x*y=k model, 0 fee)
    function getQuantityOut(address tokenIn, uint256 amountIn) public view returns (uint256) {
        require(amountIn > 0, "Invalid amount");
        require(tokenIn == token0 || tokenIn == token1, "Invalid token");
        if (tokenIn == token0) {
            // dy = y - (x*y)/(x+dx)
            return reserve1 - (reserve0 * reserve1) / (reserve0 + amountIn);
        } else {
            return reserve0 - (reserve1 * reserve0) / (reserve1 + amountIn);
        }
    }

    function getOutputTokenAddress(address tokenIn) external view returns (address) {
        require(tokenIn == token0 || tokenIn == token1, "Invalid token");
        return tokenIn == token0 ? token1 : token0;
    }

    // ---------------- Internal helpers ----------------

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) { y = z; z = (x / z + z) / 2; }
    }

    function _update(uint256 bal0, uint256 bal1) private {
        reserve0 = bal0;
        reserve1 = bal1;
        emit Sync(reserve0, reserve1);
    }

    // ---------------- Liquidity ----------------

    /// @notice Add liquidity - automatically adjusts to current pool ratio
    /// Router must hold/approve funds before calling (router is msg.sender).
    function addLiquidity(uint256 amount0, uint256 amount1) external nonReentrant returns (uint256 liquidity) {
        require(amount0 > 0 && amount1 > 0, "Invalid amount");

        uint256 _reserve0 = reserve0;
        uint256 _reserve1 = reserve1;

        uint256 actualAmount0;
        uint256 actualAmount1;

        if (_reserve0 == 0 && _reserve1 == 0) {
            // First liquidity addition
            actualAmount0 = amount0;
            actualAmount1 = amount1;
            liquidity = _sqrt(amount0 * amount1);
            require(liquidity > 0, "Insufficient liquidity minted");
        } else {
            // Calculate optimal amounts based on current reserves
            uint256 amount1Optimal = (amount0 * _reserve1) / _reserve0;
            uint256 amount0Optimal = (amount1 * _reserve0) / _reserve1;

            if (amount1Optimal <= amount1) {
                // Use amount0 and calculated amount1Optimal
                actualAmount0 = amount0;
                actualAmount1 = amount1Optimal;
            } else {
                // Use amount1 and calculated amount0Optimal  
                actualAmount0 = amount0Optimal;
                actualAmount1 = amount1;
            }

            // Calculate liquidity tokens to mint
            uint256 ts = totalSupply();
            uint256 liq0 = (actualAmount0 * ts) / _reserve0;
            uint256 liq1 = (actualAmount1 * ts) / _reserve1;
            liquidity = liq0 < liq1 ? liq0 : liq1;
            require(liquidity > 0, "Insufficient liquidity minted");
        }

        // Pull the actual amounts needed from caller
        IERC20(token0).transferFrom(msg.sender, address(this), actualAmount0);
        IERC20(token1).transferFrom(msg.sender, address(this), actualAmount1);

        // Mint LP tokens to caller (router)
        _mint(msg.sender, liquidity);

        // If there are leftover tokens that weren't used, return them
        if (actualAmount0 < amount0) {
            // Note: In a real implementation, you might want to handle this differently
            // For now, the router should handle excess approvals
        }
        if (actualAmount1 < amount1) {
            // Note: In a real implementation, you might want to handle this differently
            // For now, the router should handle excess approvals
        }

        // Update reserves
        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
        emit Mint(msg.sender, actualAmount0, actualAmount1, liquidity);
    }

    /// @notice Remove liquidity; caller must hold/burn LP
    function removeLiquidity(uint256 liquidity) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        require(balanceOf(msg.sender) >= liquidity, "LP low");
        uint256 ts = totalSupply();
        require(ts > 0, "No LP");

        // amounts proportional
        amount0 = (liquidity * reserve0) / ts;
        amount1 = (liquidity * reserve1) / ts;

        _burn(msg.sender, liquidity);

        IERC20(token0).transfer(msg.sender, amount0);
        IERC20(token1).transfer(msg.sender, amount1);

        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
        emit Burn(msg.sender, liquidity, amount0, amount1, msg.sender);
    }

    // ---------------- Swap ----------------

    /// @notice Swap exact tokenIn for its pair tokenOut (router multi-hop compatible)
    /// Router must hold+approve tokenIn for this pair before calling.
    function swap(address tokenIn, uint256 amountIn) external nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0, "Invalid amount");
        require(tokenIn == token0 || tokenIn == token1, "Invalid token");

        // Take tokenIn from caller
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        if (tokenIn == token0) {
            amountOut = reserve1 - (reserve0 * reserve1) / (reserve0 + amountIn);
            require(amountOut <= reserve1, "Insufficient liquidity");
            IERC20(token1).transfer(msg.sender, amountOut);
        } else {
            amountOut = reserve0 - (reserve1 * reserve0) / (reserve1 + amountIn);
            require(amountOut <= reserve0, "Insufficient liquidity");
            IERC20(token0).transfer(msg.sender, amountOut);
        }

        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
        emit Swap(msg.sender, tokenIn, amountIn, tokenIn == token0 ? token1 : token0, amountOut, msg.sender);
    }
}