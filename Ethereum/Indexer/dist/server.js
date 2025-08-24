"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
app.get("/pool", async (req, res) => {
    const pools = await prisma.pool.findMany({
        include: { tokenA: true, tokenB: true }
    });
    res.json(pools);
});
app.get("/pool/:id", async (req, res) => {
    const ID = Number(req.params.id);
    const poolId = await prisma.pool.findUnique({
        where: { id: ID },
        include: { liquidity: true, swaps: true },
    });
    res.json(poolId);
});
app.listen(3000, () => {
    console.log("Backend Server Started");
});
