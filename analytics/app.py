from flask import Flask, request, jsonify
from sklearn.ensemble import IsolationForest
import numpy as np
import datetime

app = Flask(__name__)

# In-memory history for demo (Use Redis/DB in prod)
# Structure: { 'patientHash': [timestamps], 'doctorAddress': [timestamps] }
HISTORY = {
    'patients': {},
    'doctors': {}
}

@app.route('/analyze', methods=['POST'])
def analyze():
    data = request.json
    p_hash = data.get('patientHash')
    d_addr = data.get('doctorAddress')
    
    now = datetime.datetime.now()
    
    # 1. Update History
    if p_hash not in HISTORY['patients']:
        HISTORY['patients'][p_hash] = []
    HISTORY['patients'][p_hash].append(now)
    
    # Cleanup old events (> 1 hour)
    HISTORY['patients'][p_hash] = [t for t in HISTORY['patients'][p_hash] if (now - t).seconds < 3600]
    
    # 2. Rule-Based Analysis (Frequency)
    # If patient got > 3 prescriptions in 1 hour -> High Risk
    count = len(HISTORY['patients'][p_hash])
    
    risk_score = 0
    reason = "Normal usage pattern."
    
    if count > 3:
        risk_score = 0.8
        reason = f"High frequency: {count} prescriptions in last hour."
    elif count > 1:
        risk_score = 0.3
        reason = "Moderate frequency."
        
    return jsonify({
        'risk_score': risk_score,
        'reason': reason,
        'count_last_hour': count
    })

if __name__ == '__main__':
    print("Analytics Service Running on Port 5001")
    app.run(port=5001)
