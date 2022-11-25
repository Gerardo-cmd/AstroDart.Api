import fetch from "node-fetch";
import express from 'express';
import cors from 'cors';
import fs from "fs";
import path from 'path';
import md5 from "md5";
import jwt from "jsonwebtoken";
import env from "dotenv";
import admin from 'firebase-admin';
import auth from "./middleware/auth.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const app = express();

// Load in .ENV file contents
env.config();

// Use express's body parser for post requests
app.use(express.json());

// Activate cors
app.use(cors({
    origin: ['http://localhost:3000'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET, POST', 'DELETE'],
    optionsSuccessStatus: 200
}));