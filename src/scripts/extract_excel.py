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
        html_content = ""
        is_html = False

        if ext == '.csv':
            raw_df = pd.read_csv(file_path, header=None)
            html_content = raw_df.to_html(classes=['table', 'table-bordered', 'w-full', 'text-xs'], border=1, header=False, index=False, na_rep='')
        else:
            # For xls and xlsx, we first check if it's actually an HTML file in disguise
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read(2000)
                if any(tag in content.lower() for tag in ['<html', '<table', '<!doctyp']):
                    is_html = True
            
            if is_html:
                # Disguised HTML file, return its exact content
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    html_content = f.read()
            else:
                # Genuine Excel file
                engine = 'openpyxl' if ext == '.xlsx' else 'xlrd'
                raw_df = pd.read_excel(file_path, header=None, engine=engine)
                html_content = raw_df.to_html(classes=['table', 'table-bordered', 'w-full', 'text-xs'], border=1, header=False, index=False, na_rep='')

        if not html_content:
            return {"error": "The file appears to be empty or could not be read"}

        return {
            "htmlContent": html_content,
            "rowCount": 0, # Not applicable anymore, but keep field for compatibility
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
