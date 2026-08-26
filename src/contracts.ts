export const CONFIGURATION_SECTION = "simplicityhl";
export const LANGUAGE_CLIENT_ID = "simplicityhlLspClient";
export const LANGUAGE_CLIENT_NAME = "SimplicityHL LSP";
export const SERVER_BINARY = "simplicityhl-lsp";
export const FORMATTER_BINARY = "simfmt";
export const FORMATTER_UPDATE_CACHE_KEY = "simfmt.lastUpdateAttemptAt";
export const TASK_TYPE = "simplicityhl";

export const LANGUAGE_IDS = {
  source: "simplicityhl",
  witness: "simplicityhl-witness",
} as const;

export const COMMAND_IDS = {
  restartServer: "simplicityhl.restartServer",
  compileFile: "simplicityhl.compileFile",
  compileFileDebug: "simplicityhl.compileFileDebug",
  compileWithWitness: "simplicityhl.compileWithWitness",
  compileJson: "simplicityhl.compileJson",
  formatFile: "simplicityhl.formatFile",
} as const;

export const TASK_COMMANDS = [
  "compile",
  "compile-debug",
  "compile-with-witness",
] as const;

export const SETTINGS = {
  suppressMissingLspWarning: {
    key: "suppressMissingLspWarning",
    default: false,
  },
  disableAutoupdate: {
    key: "disableAutoupdate",
    default: false,
  },
  serverPath: {
    key: "server.path",
    default: "",
  },
  compilerPath: {
    key: "compiler.path",
    default: "",
  },
  formatterPath: {
    key: "formatter.path",
    default: "",
  },
  autoSaveBeforeFormat: {
    key: "formatter.autoSaveBeforeFormat",
    default: true,
  },
  formatterDisableAutoupdate: {
    key: "formatter.disableAutoupdate",
    default: true,
  },
  autoSaveBeforeCompile: {
    key: "build.autoSaveBeforeCompile",
    default: true,
  },
  imports: {
    key: "experimentalFeatures.imports",
    default: false,
  },
  enums: {
    key: "experimentalFeatures.enums",
    default: false,
  },
} as const;

export type TaskCommand = (typeof TASK_COMMANDS)[number];

export interface ExperimentalFeatures {
  imports: boolean;
  enums: boolean;
}

export function languageClientOptions(features: ExperimentalFeatures) {
  return {
    documentSelector: [
      { scheme: "file", language: LANGUAGE_IDS.source },
      { scheme: "file", language: LANGUAGE_IDS.witness },
    ],
    initializationOptions: {
      simplicityhl: {
        experimentalFeatures: features,
      },
    },
    synchronize: {
      configurationSection: CONFIGURATION_SECTION,
    },
  };
}
