console.log("Test script starting...");

const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");

async function test() {
  console.log("Creating form...");
  const form = new FormData();
  form.append("file", fs.createReadStream("test_data.csv"));
  form.append("description", "Test dataset");

  try {
    console.log("Sending request...");
    const response = await axios.post(
      "http://localhost:3001/api/data-quality/llm-analyze",
      form,
      {
        headers: form.getHeaders(),
        timeout: 10000,
      },
    );
    console.log("Success:", response.status);
    console.log("Assessment:", response.data.overall_assessment);
  } catch (e) {
    console.error("Error:", e.message);
  }
}

test();
