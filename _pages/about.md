---
layout: about
title: about
permalink: /
subtitle: 

profile:
  align: right
  image: 2022.jpg
  image_circular: false # crops the image to make it circular
  more_info:
news: false # includes a list of news items
selected_papers: true # includes a list of papers marked as "selected={true}"
social: true # includes social icons at the bottom of the page
talk: false

---

a PhD student at Syracuse University, advised by [Kristopher Micinski](https://kmicinski.com/).  

**I'm seeking a full-time position beginning 2027. If your team has an opening, or you know someone who does, I'd be grateful for an introduction.**

My research sits at the intersection of Programming Languages, Machine Learning, and Security, with a focus on reverse engineering: taking binaries and recovering something a human can read and reason about.

My current work is a [prototype Datalog C decompiler](https://github.com/changliu98/manifold) that treats decompilation the way modern compilers treat compilation: as a chain of small, logic-defined passes over a shared fact store, keeping ambiguous interpretations as evidence rather than committing early to one. It's implemented in 35K lines of Rust and Datalog, lifts Linux ELF binaries to C99.

Previously, I built data infrastructure for binary analysis. [Assemblage](https://assemblagedocs.readthedocs.io/en/latest/) is a distributed build system and a family of labeled binary datasets produced by compiling open-source projects at scale. It appeared at NeurIPS 2024, and the datasets are widely used across the field.
