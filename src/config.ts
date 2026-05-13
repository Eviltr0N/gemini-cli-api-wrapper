/**
 * Server configuration.
 *
 * Supports CLI args and environment variables:
 *   --port <number>   or  PORT env var       (default: 3000)
 *   --model <name>    or  DEFAULT_MODEL env   (default: gemini-2.5-flash)
 *   --help            Show usage info
 */

export interface ServerConfig {
  port: number;
  defaultModel: string;
  enableToolsByDefault: boolean;
}

function getArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    // --port=3000 style
    if (args[i].startsWith(`--${name}=`)) {
      return args[i].split('=')[1];
    }
    // --port 3000 style
    if (args[i] === `--${name}` && i + 1 < args.length) {
      return args[i + 1];
    }
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

export function loadConfig(): ServerConfig {
  if (hasFlag('help') || hasFlag('h')) {
    console.log(`
Usage: gemini-cli-api-wrapper [options]

Options:
  --port <number>    Server port (default: 3000, env: PORT)
  --model <name>     Default Gemini model (default: gemini-2.5-flash, env: DEFAULT_MODEL)
  --help, -h         Show this help message

Examples:
  npx gemini-cli-api-wrapper
  npx gemini-cli-api-wrapper --port 8080
  npx gemini-cli-api-wrapper --port 8080 --model gemini-2.5-pro
  PORT=8080 DEFAULT_MODEL=gemini-2.5-pro npx gemini-cli-api-wrapper
`);
    process.exit(0);
  }

  const portStr = getArg('port') || process.env['PORT'] || '3000';
  const port = parseInt(portStr, 10);

  return {
    port: isNaN(port) ? 3000 : port,
    defaultModel: getArg('model') || process.env['DEFAULT_MODEL'] || 'gemini-2.5-flash',
    enableToolsByDefault: false,
  };
}
