import Papa from 'papaparse';
import { stripBom } from './importValidation';

export interface ParsedCsvData {
  headers: string[];
  rows: Record<string, string>[];
  parseErrors: Papa.ParseError[];
}

/**
 * Standardized CSV parsing with PapaParse supporting BOM removal, quoted fields,
 * embedded newlines/commas, and whitespace trimming.
 */
export function parseCsvContent(csvString: string): ParsedCsvData {
  const cleanedString = stripBom(csvString.trim());

  const result = Papa.parse<Record<string, string>>(cleanedString, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header: string) => header.trim(),
    transform: (value: string) => value.trim(),
  });

  const headers = result.meta.fields || [];
  const rows = result.data.filter((row) => {
    // Exclude completely empty rows
    return Object.values(row).some((val) => val !== undefined && val !== '');
  });

  return {
    headers,
    rows,
    parseErrors: result.errors,
  };
}

