// api/index.ts
import { createRequestHandler } from "@react-router/node";

// @ts-ignore
const build = await import("../build/server/index.js");

export default createRequestHandler({
    build: build.default || build,
    mode: process.env.NODE_ENV || "production",
});