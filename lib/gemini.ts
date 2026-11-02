import { GoogleGenerativeAI } from "@google/generative-ai";
import type { TestCaseFormat } from "./claude";

const client = new GoogleGenerativeAI(process.env.GOOGLE_GENAI_API_KEY!);

const FORMAT_INSTRUCTIONS: Record<TestCaseFormat, string> = {
  plain: `Return the test cases as a plain numbered list. For each test case include:
- Test case number and name
- Description
- Preconditions
- Steps to reproduce
- Expected result`,

  json: `Return the test cases as a valid JSON array. Each test case object should have:
{
  "id": "TC-001",
  "name": "string",
  "description": "string",
  "preconditions": ["string"],
  "steps": ["string"],
  "expected_result": "string",
  "priority": "High|Medium|Low",
  "type": "Functional|UI|Accessibility|Edge Case"
}
Return ONLY valid JSON, no markdown code blocks.`,

  gherkin: `Return the test cases in Gherkin BDD format using Feature/Scenario/Given/When/Then syntax.
Example:
Feature: [Feature name from design]

  Scenario: [Test case name]
    Given [precondition]
    When [action]
    Then [expected result]`,

  markdown: `Return the test cases as a Markdown table with these columns:
| ID | Test Case | Description | Steps | Expected Result | Priority | Type |
|---|---|---|---|---|---|---|`,

  excel: `Return the test cases as a JSON array (it will be converted to Excel). Each object should have these exact keys:
{
  "ID": "TC-001",
  "Test Case": "string",
  "Description": "string",
  "Preconditions": "string",
  "Steps": "step1; step2; step3",
  "Expected Result": "string",
  "Priority": "High|Medium|Low",
  "Type": "Functional|UI|Accessibility|Edge Case"
}
Return ONLY valid JSON array, no markdown code blocks.`,
};

function buildPrompt(format: TestCaseFormat, context?: string): string {
  const contextSection = context?.trim()
    ? `\nAdditional context about this screen:\n${context.trim()}\n`
    : "";

  return `You are an expert QA engineer. Analyze the provided UI design screenshot(s) and generate comprehensive test cases.
If multiple screenshots are provided, they represent different parts or states of the same screen — analyze them together as one cohesive view.
${contextSection}
Identify all interactive elements, user flows, form fields, buttons, navigation, and edge cases.
Consider: functional testing, UI/UX validation, accessibility, error states, boundary conditions.

${FORMAT_INSTRUCTIONS[format]}

Generate at least 8-12 thorough test cases covering the happy path and edge cases.`;
}

export interface ImageInput {
  imageBase64: string;
  mediaType: string;
}

/** Build content parts array: one or more images followed by the prompt */
function buildContentParts(imageInputs: ImageInput[], format: TestCaseFormat, context?: string) {
  const imageParts = imageInputs.map((img) => ({
    inlineData: { data: img.imageBase64, mimeType: img.mediaType },
  }));
  return [...imageParts, buildPrompt(format, context)];
}

export async function analyzeDesignStream(
  imageInputs: ImageInput[],
  format: TestCaseFormat,
  context?: string
): Promise<ReadableStream<Uint8Array>> {
  const model = client.getGenerativeModel({
    model: "gemini-2.5-flash",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: { maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } } as any,
  });

  const streamResult = await model.generateContentStream(
    buildContentParts(imageInputs, format, context)
  );

  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of streamResult.stream) {
          const text = chunk.text();
          if (text) controller.enqueue(encoder.encode(text));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

export async function analyzeDesign(
  imageInputs: ImageInput[],
  format: TestCaseFormat,
  context?: string
): Promise<string> {
  const model = client.getGenerativeModel({
    model: "gemini-2.5-flash",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: { maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } } as any,
  });

  const result = await model.generateContent(
    buildContentParts(imageInputs, format, context)
  );

  const content = result.response.text();
  if (!content) throw new Error("No response from Gemini");
  return content;
}
