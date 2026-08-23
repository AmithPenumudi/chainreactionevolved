import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (
      err.code === "ERR_MODULE_NOT_FOUND" &&
      !specifier.endsWith(".ts") &&
      (specifier.startsWith("./") || specifier.startsWith("../"))
    ) {
      return nextResolve(specifier + ".ts", context);
    }
    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".ts")) {
    const path = fileURLToPath(url);
    const source = await readFile(path, "utf8");
    const out = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: false,
        isolatedModules: true,
      },
      fileName: path,
    });
    return { format: "module", source: out.outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
