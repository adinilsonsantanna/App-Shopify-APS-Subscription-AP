CREATE TABLE "BillingRetrySettings" (
    "shop" TEXT NOT NULL,
    "paymentRetryAttempts" INTEGER NOT NULL DEFAULT 3,
    "paymentRetryDays" INTEGER NOT NULL DEFAULT 2,
    "paymentFailureAction" TEXT NOT NULL DEFAULT 'PAUSE_AND_NOTIFY',
    "inventoryRetryAttempts" INTEGER NOT NULL DEFAULT 5,
    "inventoryRetryDays" INTEGER NOT NULL DEFAULT 1,
    "inventoryFailureAction" TEXT NOT NULL DEFAULT 'SKIP_AND_NOTIFY',
    "teamNotificationFrequency" TEXT NOT NULL DEFAULT 'WEEKLY_SUMMARY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingRetrySettings_pkey" PRIMARY KEY ("shop")
);
