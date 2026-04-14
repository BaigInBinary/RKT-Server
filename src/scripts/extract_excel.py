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
        
        if ext in ['.xlsx', '.xls']:
            # Read everything first to find the header
            raw_df = pd.read_excel(file_path, header=None)
        elif ext == '.csv':
            raw_df = pd.read_csv(file_path, header=None)
        else:
            return {"error": f"Unsupported file extension: {ext}"}
        
        if raw_df.empty:
            return {"error": "The file appears to be empty"}

        # Heuristic to find the header row
        header_row_idx = 0
        max_non_null = 0
        found_keywords = False
        
        keywords = ['cn ', 'cn#', 'tracking', 'packet', 'order', 'amount', 'date', 'status', 'consignee', 'origin', 'destination']
        
        for i, row in raw_df.iterrows():
            row_str = ' '.join([str(val).lower() for val in row if pd.notnull(val)])
            if any(k in row_str for k in keywords):
                header_row_idx = i
                found_keywords = True
                break
                
            non_null_count = row.count()
            if non_null_count > max_non_null:
                max_non_null = non_null_count
                header_row_idx = i
        
        # Reload with the correct header
        if ext in ['.xlsx', '.xls']:
            df = pd.read_excel(file_path, header=header_row_idx)
        else:
            df = pd.read_csv(file_path, header=header_row_idx)

        # Basic Cleaning
        df = df.dropna(how='all').dropna(axis=1, how='all')
        
        # Replace NaN/NA with None (becomes null in JSON)
        # This is more robust than df.where for varied column types
        df = df.replace({pd.NA: None})
        df = df.astype(object).where(pd.notnull(df), None)
        
        # Convert to list of dicts
        data = df.to_dict(orient='records')
        
        # Get columns
        columns = df.columns.tolist()
        
        return {
            "columns": columns,
            "data": data,
            "rowCount": len(data),
            "headerRow": int(header_row_idx)
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
    # Use the custom encoder for JSON serialization
    print(json.dumps(result, cls=DateTimeEncoder))
