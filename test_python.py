import requests

url = 'http://localhost:3001/api/data-quality/llm-analyze'
files = {'file': open('test_data.csv', 'rb')}
data = {'description': 'Test dataset'}

print("Sending request to LLM analyze...")
response = requests.post(url, files=files, data=data)

print(f"Status: {response.status_code}")
print(f"Response: {response.text}")