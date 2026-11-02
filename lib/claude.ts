import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export type TestCaseFormat =
  | "plain"
  | "json"
  | "gherkin"
  | "markdown"
  | "excel";

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

const SYSTEM_PROMPT =
  "You are an expert QA engineer specialising in UI test case generation. " +
  "When given a UI screenshot or design, you produce comprehensive, actionable test cases " +
  "that cover functional behaviour, UI/UX validation, accessibility, error states, and boundary conditions.";

function buildUserMessage(format: TestCaseFormat, context?: string): string {
  const contextSection = context?.trim()
    ? `\nAdditional context about this screen:\n${context.trim()}\n`
    : "";

  return `Analyze this UI design/screenshot and generate comprehensive test cases.
${contextSection}
Identify all interactive elements, user flows, form fields, buttons, navigation, and edge cases.

${FORMAT_INSTRUCTIONS[format]}

Generate at least 8-12 thorough test cases covering the happy path and edge cases.`;
}

type SupportedMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function toSupportedMediaType(mediaType: string): SupportedMediaType {
  const supported: SupportedMediaType[] = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ];
  if (supported.includes(mediaType as SupportedMediaType)) {
    return mediaType as SupportedMediaType;
  }
  return "image/png";
}

export async function analyzeDesignStream(
  imageBase64: string,
  mediaType: string,
  format: TestCaseFormat,
  context?: string
): Promise<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model: "claude-opus-4-6",
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: toSupportedMediaType(mediaType),
                    data: imageBase64,
                  },
                },
                {
                  type: "text",
                  text: buildUserMessage(format, context),
                },
              ],
            },
          ],
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

// Non-streaming version used only for Excel (need full text to convert)
export async function analyzeDesign(
  imageBase64: string,
  mediaType: string,
  format: TestCaseFormat,
  context?: string
): Promise<string> {
  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: toSupportedMediaType(mediaType),
              data: imageBase64,
            },
          },
          {
            type: "text",
            text: buildUserMessage(format, context),
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }
  return textBlock.text;
}
