import sys
import pandas as pd
import json
import os
from datetime import datetime

class DateTimeEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (datetime, pd.Timestamp)):
            return obj.isoformat()
        return super().default(obj)

def extract_excel(file_path):
    try:
        ext = os.path.splitext(file_path)[1].lower()
        raw_df = None
        is_html = False

        if ext == '.xlsx':
            raw_df = pd.read_excel(file_path, header=None, engine='openpyxl')
        elif ext == '.xls':
            try:
                raw_df = pd.read_excel(file_path, header=None, engine='xlrd')
            except Exception:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read(500)
                    if any(tag in content.lower() for tag in ['<html', '<table', '<!doctyp']):
                        html_dfs = pd.read_html(file_path)
                        if html_dfs:
                            raw_df = pd.concat(html_dfs, ignore_index=True)
                            is_html = True
                        else:
                            raise Exception("HTML tables not found")
        elif ext == '.csv':
            raw_df = pd.read_csv(file_path, header=None)
        
        if raw_df is None or raw_df.empty:
            return {"error": "The file appears to be empty or could not be read"}

        metadata = {}
        summary = {}
        sections = []
        
        # Keywords for table headers
        header_keywords = ['cn ', 'cn#', 'tracking', 'packet', 'order', 'date', 'status', 'destination', 'amount', 'weight', 'charges']
        
        current_section = None
        current_header = None
        current_rows = []

        # Convert everything to strings for initial scanning
        df_str = raw_df.astype(str).replace('nan', '')

        for i, row in raw_df.iterrows():
            row_vals = [str(val).strip() for val in row if pd.notnull(val) and str(val).strip() != 'nan']
            row_str = ' '.join(row_vals)
            row_str_lower = row_str.lower()
            
            # --- 1. Extract Metadata (Patterns like 'Key: Value' or 'Key Value') ---
            if i < 10: # Metadata is usually at the top
                # Check for Printed on, Payment Date, Invoice No, etc.
                meta_patterns = ['printed on:', 'payment date:', 'invoice no.:', 'payment status:', 'bank name:', 'cheque no.:', 'cheque date:']
                for p in meta_patterns:
                    if p in row_str_lower:
                        # Simple extraction logic: find the pattern and take text after it until the next pattern
                        parts = row_str.split(':')
                        for idx in range(len(parts)-1):
                            key = parts[idx].split(' ')[-2:] if ' ' in parts[idx] else [parts[idx]]
                            key = ' '.join(key).strip()
                            val = parts[idx+1].split('  ')[0].strip() # Take until multiple spaces
                            if key and val:
                                metadata[key] = val

            # --- 2. Extract Summary Section ---
            if 'summary' in row_str_lower and len(row_vals) == 1:
                # If we were in a section, close it
                if current_section and current_rows:
                    sections.append({"title": current_section, "columns": current_header, "rows": current_rows})
                current_section = "SUMMARY"
                current_header = None
                current_rows = []
                continue

            if current_section == "SUMMARY":
                if row_vals and len(row_vals) <= 3:
                    # Capture label and value (e.g., 'Gross payable', '24,768.00')
                    label = row_vals[0].replace(':', '').strip()
                    val = row_vals[-1].strip()
                    summary[label] = val
                elif not row_vals:
                    # Empty row might end the summary
                    continue
                # If it looks like a new header, break summary
                match_count = sum(1 for k in header_keywords if k in row_str_lower)
                if match_count < 3:
                    continue

            # --- 3. Extract Table Sections ---
            match_count = sum(1 for k in header_keywords if k in row_str_lower)
            if match_count >= 3:
                # Found a header! Save previous block
                if current_section and current_rows and current_section != "SUMMARY":
                    sections.append({"title": current_section, "columns": current_header, "rows": current_rows})
                
                current_header = [v for v in row_vals]
                # Preceding row is usually the section title
                if i > 0:
                    prev_vals = [str(v).strip() for v in raw_df.iloc[i-1] if pd.notnull(v) and str(v).strip() != 'nan']
                    current_section = ' '.join(prev_vals) if prev_vals else f"Section {len(sections)+1}"
                else:
                    current_section = "Data Section"
                current_rows = []
                continue

            if current_header:
                if 'total' in row_str_lower:
                    # Save and reset when hitting a Total row
                    if current_rows:
                        sections.append({"title": current_section, "columns": current_header, "rows": current_rows})
                    current_header = None
                    current_section = None
                    current_rows = []
                elif row_vals:
                    # Map row data to header keys
                    row_obj = {}
                    for idx, val in enumerate(row.tolist()):
                        if idx < len(current_header):
                            col_name = current_header[idx]
                            row_obj[col_name] = val if pd.notnull(val) else None
                    current_rows.append(row_obj)

        # Catch last section
        if current_section and current_rows and current_section != "SUMMARY":
            sections.append({"title": current_section, "columns": current_header, "rows": current_rows})

        return {
            "metadata": metadata,
            "sections": sections,
            "summary": summary,
            "rowCount": sum(len(s["rows"]) for s in sections),
            "isHtml": is_html
        }
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No file path provided"}))
        sys.exit(1)
    
    file_path = sys.argv[1]
    result = extract_excel(file_path)
    print(json.dumps(result, cls=DateTimeEncoder))
