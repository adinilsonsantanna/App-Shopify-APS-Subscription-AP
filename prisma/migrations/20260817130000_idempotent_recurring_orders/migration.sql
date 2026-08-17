CREATE TABLE "RecurringOrderRequest" (
  "idempotencyKey" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "shopifyOrderId" TEXT,
  "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecurringOrderRequest_pkey" PRIMARY KEY ("idempotencyKey")
);
CREATE UNIQUE INDEX "RecurringOrderRequest_shop_invoiceId_key" ON "RecurringOrderRequest"("shop", "invoiceId");
CREATE INDEX "RecurringOrderRequest_status_leaseExpiresAt_idx" ON "RecurringOrderRequest"("status", "leaseExpiresAt");
