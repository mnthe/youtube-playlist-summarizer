#!/usr/bin/env node

import { createCLI } from './adapters/cli/index.js';

const cli = createCLI();
cli.parse(process.argv);
