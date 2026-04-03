const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");

async function testLLM() {
  const form = new FormData();
  form.append("file", fs.createReadStream("test_data.csv"), "test_data.csv");
  form.append("description", "Dataset de test avec des employés français");

  try {
    console.log("Testing LLM analysis endpoint...");
    const response = await axios.post(
      "http://localhost:3001/api/data-quality/llm-analyze",
      form,
      {
        headers: form.getHeaders(),
        timeout: 30000,
      },
    );

    console.log("Status:", response.status);
    console.log("Response keys:", Object.keys(response.data));

    // Vérifier la langue
    const overall = response.data.overall_assessment || "";
    console.log("Overall assessment:", overall);
    const hasEnglish =
      overall.toLowerCase().includes("the") ||
      overall.toLowerCase().includes("and") ||
      overall.toLowerCase().includes("is");
    console.log("Seems to contain English:", hasEnglish);
  } catch (error) {
    console.error("Error:", error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
    }
  }
}

testLLM();
