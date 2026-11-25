#!/usr/bin/env node
/**
 * Direct invoker for Capacitor CLI.
 * Bypasses the strict semver check in @capacitor/cli/bin/capacitor
 * while running the exact same CLI command logic.
 */
const cli = require('@capacitor/cli/dist/index');
cli.run();
