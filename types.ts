export enum ConversionMode {
  SPEC_TO_DOC = 'SPEC_TO_DOC',
  DOC_TO_SPEC = 'DOC_TO_SPEC',
}

export enum SpecFormat {
  YAML = 'YAML',
  JSON = 'JSON',
}

export interface ConversionOptions {
  includeExamples: boolean;
  includeAuthentication: boolean;
  outputFormat: SpecFormat; // Only relevant for Doc -> Spec
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  mode: ConversionMode;
  preview: string;
}