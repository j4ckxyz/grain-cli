export type ParsedArgs = {
  positional: string[];
  options: Map<string, string[]>;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const options = new Map<string, string[]>();

  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (!token.startsWith("--") || token === "--") {
      positional.push(token);
      i += 1;
      continue;
    }

    const eqIndex = token.indexOf("=");
    if (eqIndex > -1) {
      const key = token.slice(2, eqIndex);
      const value = token.slice(eqIndex + 1);
      pushOption(options, key, value);
      i += 1;
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      pushOption(options, key, next);
      i += 2;
      continue;
    }

    pushOption(options, key, "true");
    i += 1;
  }

  return { positional, options };
}

export function hasOption(options: Map<string, string[]>, key: string): boolean {
  return options.has(key);
}

export function getOption(options: Map<string, string[]>, key: string): string | undefined {
  const values = options.get(key);
  if (!values || values.length === 0) {
    return undefined;
  }
  return values[values.length - 1];
}

export function getOptionList(options: Map<string, string[]>, key: string): string[] {
  return options.get(key) ?? [];
}

function pushOption(options: Map<string, string[]>, key: string, value: string): void {
  const current = options.get(key);
  if (!current) {
    options.set(key, [value]);
    return;
  }
  current.push(value);
}
