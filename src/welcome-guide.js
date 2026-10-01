/*
 * Markdown syntax cheat sheet shown on the Welcome tab.
 *
 * Adapted from "Markdown Cheat Sheet" in The Markdown Guide by Matt Cone,
 * https://www.markdownguide.org/cheat-sheet/
 * Licensed under CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/
 *
 * Changes: reorganized into name / syntax / preview rows, light wording edits,
 * and a local example image.
 * This file (and only this file) is licensed under CC BY-SA 4.0. The rest of
 * Files.md is MIT-licensed.
 */

export const GUIDE_SOURCE = {
  title: "Markdown Cheat Sheet",
  url: "https://www.markdownguide.org/cheat-sheet/",
  site: "https://www.markdownguide.org",
  author: "Matt Cone",
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  basicUrl: "https://www.markdownguide.org/basic-syntax/",
  extendedUrl: "https://www.markdownguide.org/extended-syntax/",
};

export const GUIDE = [
  {
    title: "Basic syntax",
    intro:
      "These are the elements in John Gruber's original design. All Markdown applications support them.",
    items: [
      { name: "Heading", md: "# H1\n## H2\n### H3" },
      { name: "Bold", md: "**bold text**" },
      { name: "Italic", md: "*italicized text*" },
      { name: "Blockquote", md: "> blockquote" },
      { name: "Ordered list", md: "1. First item\n2. Second item\n3. Third item" },
      { name: "Unordered list", md: "- First item\n- Second item\n- Third item" },
      { name: "Code", md: "`code`" },
      { name: "Horizontal rule", md: "---" },
      { name: "Link", md: "[Markdown Guide](https://www.markdownguide.org)" },
      { name: "Image", md: "![alt text](image.png)", image: true },
    ],
  },
  {
    title: "Extended syntax",
    intro:
      "These elements add extra features to the basic syntax. Not every Markdown application supports them.",
    items: [
      { name: "Table", md: "| Syntax | Description |\n| ----------- | ----------- |\n| Header | Title |\n| Paragraph | Text |" },
      { name: "Fenced code block", md: '```\n{\n  "firstName": "John",\n  "lastName": "Smith",\n  "age": 25\n}\n```' },
      { name: "Footnote", md: "Here's a sentence with a footnote. [^1]\n\n[^1]: This is the footnote." },
      { name: "Heading ID", md: "### My Great Heading {#custom-id}" },
      { name: "Definition list", md: "term\n: definition" },
      { name: "Strikethrough", md: "~~The world is flat.~~" },
      { name: "Task list", md: "- [x] Write the press release\n- [ ] Update the website\n- [ ] Contact the media" },
      { name: "Emoji", md: "That is so funny! :joy:" },
      { name: "Highlight", md: "I need to highlight these ==very important words==." },
      { name: "Subscript", md: "H~2~O" },
      { name: "Superscript", md: "X^2^" },
    ],
  },
];
