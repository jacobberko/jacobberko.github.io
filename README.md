# jacobberko.com

The source for Jake Berko’s personal portfolio: a recruiter-friendly collection of software, the Throttle AI trading platform, music, and photography presented through a cyber-retro “BERKO//OS” interface.

## Stack

- Jekyll 4.2
- Semantic HTML and Liquid templates
- SCSS
- Framework-free JavaScript
- GitHub Pages with a custom domain

## Sections

- `/` — profile, experience, skills, coursework, and contact
- `/code/` — mobile apps, algorithms, games, and web projects
- `/creative/` — the *Waves* electronic album and visual archive
- `/business/` — Startup: Throttle, a policy-driven AI trading platform
- `/portfolio/` — standalone “Through My Lens” photography archive, linked from Creative

The interface includes responsive layouts, reduced-motion support, keyboard-accessible dialogs, a custom pointer treatment, animated route transitions, an image lightbox, and a few deliberately hidden easter eggs.

## Local development

The repository targets Ruby 3.0.2 and Bundler 2.3.10.

```sh
bundle install
bundle exec jekyll serve
```

Then open the local address printed by Jekyll. Production is served from [jacobberko.com](https://jacobberko.com).
