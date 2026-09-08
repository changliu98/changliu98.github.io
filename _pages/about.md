---
layout: about
permalink: /
subtitle: PhD student at Syracuse University

profile:
  align: right
  image: 2022.jpg
  image_circular: false # crops the image to make it circular
  more_info:
news: false # includes a list of news items
selected_papers: true # includes a list of papers marked as "selected={true}"
social: true # includes social icons at the bottom of the page

---

I am a PhD student at Syracuse University, advised by [Kristopher Micinski](https://kmicinski.com/).

My research is on reverse engineering, at the intersection of programming
languages, machine learning, and security. I build systems that recover
interpretations a human or a language model can actually reason about from stripped binaries.

My work spans the evolution of reverse engineering, from machine-learning-based techniques to modern approaches built around LLMs.

* **[Assemblage](https://assemblage-dataset.net/)**, a
  distributed build system that compiles open-source software at scale into
  families of binary datasets, *NeurIPS Datasets & Benchmarks 2024.* Its successor, **Assemblage-DeepHistory**, adds temporal coverage, with CVE labels and multi-year build history.
* **[Manifold](https://github.com/changliu98/manifold)**, a declarative decompiler that
  treats decompilation the way modern compilers treat compilation: a sequence
  of small, logic-defined passes over a shared, monotonically growing fact
  store, carrying ambiguous liftings forward as parallel candidates with provenance and
  resolving them in a final selection phase.
* My ongoing work explores behavioral evaluation of LLM-based decompilers, LLM-assisted decompilation, and symbolic decompilation.

I work in Rust, Python, Datalog, and C. My experience spans the CompCert and LLVM toolchains, as well as Ghidra, IDA Pro, and AFL++. My interests span decompiler construction, vulnerability analysis, and logic programming.

<div class="callout" markdown="1">
**I'm seeking a full-time position beginning Fall 2027.** If your team has an opening, or you know someone who does, I'd be grateful for an introduction.
</div>
