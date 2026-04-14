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
        # Determine file extension
        ext = os.path.splitext(file_path)[1].lower()
        
        raw_df = None
        is_html = False

        if ext == '.xlsx':
            raw_df = pd.read_excel(file_path, header=None, engine='openpyxl')
        elif ext == '.xls':
            try:
                raw_df = pd.read_excel(file_path, header=None, engine='xlrd')
            except Exception as e:
                # Check if it's actually HTML
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read(200)
                    if '<html' in content.lower() or '<table' in content.lower() or '<!doctyp' in content.lower():
                        html_dfs = pd.read_html(file_path)
                        if html_dfs:
                            # Heuristic: Find the table with the most columns that looks like a report
                            best_table = html_dfs[0]
                            max_cols = 0
                            keywords = ['cn ', 'cn#', 'tracking', 'packet', 'order', 'amount', 'date', 'status', 'consignee', 'origin', 'destination']
                            
                            for table in html_dfs:
                                # Check columns or first 5 rows for keywords
                                check_str = ' '.join([str(c).lower() for c in table.columns])
                                for _, row in table.head(5).iterrows():
                                    check_str += ' ' + ' '.join([str(v).lower() for v in row if pd.notnull(v)])
                                
                                if any(k in check_str for k in keywords):
                                    if table.shape[1] > max_cols:
                                        max_cols = table.shape[1]
                                        best_table = table
                                
                            raw_df = best_table
                            is_html = True
                        else:
                            raise e
                    else:
                        raise e
        elif ext == '.csv':
            raw_df = pd.read_csv(file_path, header=None)
        else:
            return {"error": f"Unsupported file extension: {ext}"}
        
        if raw_df is None or raw_df.empty:
            return {"error": "The file appears to be empty or could not be read"}

        # Heuristic to find the header row
        header_row_idx = -1 # -1 means the columns are already the header
        max_non_null = 0
        keywords = ['cn ', 'cn#', 'tracking', 'packet', 'order', 'amount', 'date', 'status', 'consignee', 'origin', 'destination']
        
        # Check if columns are already the header (common in HTML parsing)
        col_str = ' '.join([str(c).lower() for c in raw_df.columns])
        if any(k in col_str for k in keywords):
            header_row_idx = -1
        else:
            # Search rows for the header
            for i, row in raw_df.iterrows():
                row_str = ' '.join([str(val).lower() for val in row if pd.notnull(val)])
                if any(k in row_str for k in keywords):
                    header_row_idx = i
                    break
                    
                non_null_count = row.count()
                if non_null_count > max_non_null:
                    max_non_null = non_null_count
                    header_row_idx = i
        
        # Process the DataFrame based on the discovered header
        if header_row_idx == -1:
            # Columns are already correct
            data_df = raw_df.copy()
        else:
            # Use found row as header
            columns = raw_df.iloc[header_row_idx].tolist()
            # Convert all columns to strings and handle None
            columns = [str(c) if pd.notnull(c) else f"Unnamed: {idx}" for idx, c in enumerate(columns)]
            
            # Take everything AFTER the header
            data_df = raw_df.iloc[header_row_idx + 1:].copy()
            data_df.columns = columns
        
        # Basic Cleaning
        data_df = data_df.dropna(how='all').dropna(axis=1, how='all')
        
        # Replace NaN/NA with None
        data_df = data_df.replace({pd.NA: None})
        data_df = data_df.astype(object).where(pd.notnull(data_df), None)
        
        # Convert to list of dicts
        data = data_df.to_dict(orient='records')
        
        return {
            "columns": data_df.columns.tolist(),
            "data": data,
            "rowCount": len(data),
            "headerRow": int(header_row_idx),
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
