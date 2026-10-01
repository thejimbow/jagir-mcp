#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAdapters } from './platforms/index.js';
import { createServer } from './server.js';

const server = createServer(createAdapters());
await server.connect(new StdioServerTransport());
