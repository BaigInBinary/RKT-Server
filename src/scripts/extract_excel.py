import sys
import pandas as pd
import json
import os

def extract_excel(file_path):
    try:
        # Determine file extension
        ext = os.path.splitext(file_path)[1].lower()
        
        if ext in ['.xlsx', '.xls']:
            df = pd.read_excel(file_path)
        elif ext == '.csv':
            df = pd.read_csv(file_path)
        else:
            return {"error": f"Unsupported file extension: {ext}"}
        
        # Replace NaN with None (becomes null in JSON)
        df = df.where(pd.notnull(df), None)
        
        # Convert to list of dicts
        data = df.to_dict(orient='records')
        
        # Get columns
        columns = df.columns.tolist()
        
        return {
            "columns": columns,
            "data": data,
            "rowCount": len(data)
        }
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No file path provided"}))
        sys.exit(1)
    
    file_path = sys.argv[1]
    result = extract_excel(file_path)
    print(json.dumps(result))
