# Analyze Excel File

## File: $ARGUMENTS

Use the `excel-analyst` agent to analyze this file. The agent will:

1. Open with openpyxl, list ALL sheet names and row counts
2. For each sheet: headers, data types (sample 10 rows), primary key column
3. Map columns to DDL v5.1 tables using the Excel → DDL target mapping
4. Flag data quality issues: nulls in required fields, cargo code format violations, weight inconsistencies, orphan references
5. Output: sheet summary, column-to-table mapping, quality report, migration script skeleton

Key validation rules:
- Cargo code format: `DDMM###/YY`
- `weight_net_kg` ≤ `weight_gross_kg`
- Firm split weights must sum to `weight_net_kg`
- Prices within expected range per market
