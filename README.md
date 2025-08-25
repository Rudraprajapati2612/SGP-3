# 🚀 SwapLiT - Decentralized Exchange (DEX) Platform

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)
![Solidity](https://img.shields.io/badge/Solidity-363636?style=for-the-badge&logo=solidity&logoColor=white)
![Ethers.js](https://img.shields.io/badge/Ethers.js-4E2ACD?style=for-the-badge&logo=ethereum&logoColor=white)

---

## 📖 Project Description
**SwapLiT** is a production-ready **Decentralized Exchange (DEX)** built on Ethereum/EVM-compatible blockchains.  
It implements an **Automated Market Maker (AMM)** similar to Uniswap V2, with advanced features like **multi-hop routing, portfolio tracking, real-time blockchain indexing, and trading analytics**.  
This project demonstrates full-stack blockchain development skills combining **smart contracts, backend APIs, databases, and advanced routing algorithms**.

---

## 🔑 Core Features

### ⚙️ Backend & API
- Pool management system with TVL, reserves, swap history & liquidity provider tracking.
- Advanced **multi-hop routing & optimal pathfinding** with gas estimation.
- Portfolio management APIs for tracking user liquidity positions.
- Comprehensive token directory with metadata (symbol, name, decimals, address).
- RESTful APIs with pagination, consistent response formats, and TypeScript type safety.

### ⛓ Blockchain Integration
- **UniswapV2-style AMM contracts** for swaps and liquidity management.
- **Factory & Router contracts** for pool creation and multi-hop execution.
- **Event-driven blockchain indexing** for swap, mint, and burn events.
- Real-time trade analytics including **slippage, price impact, and arbitrage detection**.

### 📊 Analytics & Intelligence
- Trading route optimization and gas-efficient swaps.
- Historical swap data and liquidity flow analysis.
- Popular token pairs & volume-based routing decisions.
- Time-series analytics with liquidity growth and trend detection.

### 🛠 Technical Highlights
- Built with **Node.js, Express, TypeScript, PostgreSQL, Prisma, ethers.js, and Solidity**.
- Graph-based routing algorithm using **Breadth-First Search (BFS)** for path discovery.
- Scalable database design for tokens, pools, swaps, and liquidity positions.
- Security practices: input validation, safe BigInt handling, env-based configs, CORS.

---

## 📐 Architecture Overview
```plaintext
Frontend (React/Next.js) 
       ↓
Backend (Node.js + Express + Prisma) 
       ↓
Database (PostgreSQL)
       ↓
Blockchain (Ethereum Smart Contracts via ethers.js)
       ↓
Indexing (Event-driven data sync & analytics)
