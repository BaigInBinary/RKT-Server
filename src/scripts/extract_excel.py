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

        payment_date = None
        cheque_number = None
        if html_content:
            import re
            plain_text = re.sub(r'<[^>]+>', ' ', html_content).replace('&nbsp;', ' ')
            
            # Extract Payment Date
            date_match = re.search(r'Payment\s*Date[:]?\s*(\d{2}/\d{2}/\d{4})', plain_text, re.IGNORECASE)
            if date_match:
                payment_date = date_match.group(1)
                
            # Extract Invoice No / Cheque Number
            inv_match = re.search(r'Invoice\s*No\.?[:]?\s*([A-Z0-9\-]+)', plain_text, re.IGNORECASE)
            if inv_match:
                cheque_number = inv_match.group(1)

        if not html_content:
            return {"error": "The file appears to be empty or could not be read"}

        return {
            "htmlContent": html_content,
            "paymentDate": payment_date,
            "chequeNumber": cheque_number,
            "rowCount": 0,
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
