// Affichage du texte d'Andréa : un sous-ensemble de markdown, construit nœud par nœud.
// Rien n'est jamais injecté comme HTML : le texte du modèle ne peut pas exécuter de code.

// Les adresses peuvent contenir des parenthèses (Wikipédia : …/42_(nombre)).
const URL = String.raw`https?:\/\/(?:[^\s<>()\]]|\([^\s<>()]*\))+`;
const INLINE = new RegExp(String.raw`(\*\*[^*\n]+\*\*|` + "`[^`\\n]+`" + String.raw`|\[[^\]\n]+\]\(${URL}\)|${URL})`, "g");

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(label, url) {
  const node = element("a", label);
  node.href = url;
  node.target = "_blank";
  node.rel = "noopener noreferrer";
  return node;
}

function inline(parent, text) {
  for (const part of text.split(INLINE)) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      parent.append(element("strong", part.slice(2, -2)));
    } else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      parent.append(element("code", part.slice(1, -1)));
    } else if (part.startsWith("[") && part.includes("](http")) {
      const cut = part.lastIndexOf("](");
      parent.append(link(part.slice(1, cut), part.slice(cut + 2, -1)));
    } else if (/^https?:\/\//.test(part)) {
      const url = part.replace(/[.,;:!?]+$/, ""); // la ponctuation finale n'appartient pas au lien
      parent.append(link(url.replace(/^https?:\/\/(www\.)?/, ""), url), part.slice(url.length));
    } else {
      parent.append(part);
    }
  }
}

function blocks(container, text) {
  let paragraph = null;
  let list = null;
  for (const line of text.split("\n")) {
    const item = line.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/);
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (item) {
      const tag = item[1] ? "ol" : "ul";
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = element(tag);
        container.append(list);
      }
      inline(list.appendChild(element("li")), item[2]);
      paragraph = null;
    } else if (heading) {
      inline(container.appendChild(element("p")).appendChild(element("strong")), heading[1]);
      paragraph = list = null;
    } else if (!line.trim()) {
      paragraph = list = null;
    } else {
      if (!paragraph) paragraph = container.appendChild(element("p"));
      else paragraph.append(element("br"));
      inline(paragraph, line.replace(/^\s*>\s?/, ""));
      list = null;
    }
  }
}

/** Remplace le contenu de `container` par le rendu de `text`. */
export function renderMarkdown(container, text) {
  container.replaceChildren();
  text.split("```").forEach((part, index) => {
    if (index % 2 === 0) {
      blocks(container, part);
    } else {
      const code = element("code", part.replace(/^[\w+-]*\n/, "").replace(/\n$/, ""));
      container.appendChild(element("pre")).append(code);
    }
  });
}
