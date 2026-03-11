import { visit } from 'unist-util-visit'
import type { Plugin } from 'unified'
import type { Root, Text } from 'mdast'

/**
 * Remark plugin that converts inline citation tags [n] into clickable badges.
 *
 * - Matches [n] where n is 1-3 digits (e.g. [1], [12], [100])
 * - Skips [^n] (footnotes handled by remarkFootnotes)
 * - Skips nodes inside link, image, or definition parents (avoids false positives on markdown links)
 * - Code blocks and math are separate AST node types, so they're naturally skipped.
 */
export const remarkCitations: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || typeof index !== 'number') return

      // Skip if parent is a link, image, or definition node (avoid matching [text](url))
      if (
        parent.type === 'link' ||
        parent.type === 'image' ||
        parent.type === 'definition' ||
        parent.type === 'linkReference' ||
        parent.type === 'imageReference'
      ) {
        return
      }

      const text = node.value
      // Match [n] but NOT [^n] (negative lookbehind for ^)
      const citationRegex = /(?<!\^)\[(\d{1,3})\]/g
      let match
      const replacements: any[] = []
      let lastIndex = 0

      while ((match = citationRegex.exec(text)) !== null) {
        const [fullMatch, refId] = match
        const startIndex = match.index!

        // Extra safety: check the character before '[' isn't '^' (for engines without lookbehind)
        if (startIndex > 0 && text[startIndex - 1] === '^') continue

        // Add preceding text
        if (startIndex > lastIndex) {
          replacements.push({
            type: 'text',
            value: text.slice(lastIndex, startIndex),
          })
        }

        // Add citation badge as raw HTML
        replacements.push({
          type: 'html',
          value: `<cite data-ref="${refId}" class="citation-badge" style="cursor:pointer">[${refId}]</cite>`,
        })

        lastIndex = startIndex + fullMatch.length
      }

      // Add remaining text
      if (lastIndex < text.length) {
        replacements.push({
          type: 'text',
          value: text.slice(lastIndex),
        })
      }

      // Replace the text node if we found citations
      if (replacements.length > 1) {
        parent.children.splice(index, 1, ...replacements)
      }
    })
  }
}
