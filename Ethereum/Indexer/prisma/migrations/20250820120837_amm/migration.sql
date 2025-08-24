-- CreateTable
CREATE TABLE "public"."Token" (
    "id" SERIAL NOT NULL,
    "address" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "decimals" INTEGER NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Pool" (
    "id" SERIAL NOT NULL,
    "address" TEXT NOT NULL,
    "tokenAId" INTEGER NOT NULL,
    "tokenBId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Liquidity" (
    "id" SERIAL NOT NULL,
    "poolId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "amountA" TEXT NOT NULL,
    "amountB" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Liquidity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Swap" (
    "id" SERIAL NOT NULL,
    "poolId" INTEGER NOT NULL,
    "trader" TEXT NOT NULL,
    "amountIn" TEXT NOT NULL,
    "amountOut" TEXT NOT NULL,
    "tokenIn" TEXT NOT NULL,
    "tokenOut" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Swap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Token_address_key" ON "public"."Token"("address");

-- CreateIndex
CREATE UNIQUE INDEX "Pool_address_key" ON "public"."Pool"("address");

-- AddForeignKey
ALTER TABLE "public"."Pool" ADD CONSTRAINT "Pool_tokenAId_fkey" FOREIGN KEY ("tokenAId") REFERENCES "public"."Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Pool" ADD CONSTRAINT "Pool_tokenBId_fkey" FOREIGN KEY ("tokenBId") REFERENCES "public"."Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Liquidity" ADD CONSTRAINT "Liquidity_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "public"."Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Swap" ADD CONSTRAINT "Swap_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "public"."Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
