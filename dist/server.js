"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const app_1 = require("./app");
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";
const start = async () => {
    const app = (0, app_1.buildApp)();
    try {
        await app.listen({ port, host });
        app.log.info(`Server listening on ${host}:${port}`);
    }
    catch (error) {
        app.log.error(error, "Failed to start server");
        process.exit(1);
    }
};
void start();
