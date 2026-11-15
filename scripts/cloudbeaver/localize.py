"""Aplica o catálogo português à compilação local do CloudBeaver."""

import argparse
import json
from pathlib import Path


def localize(source: Path):
    for html in (
        source / "webapp/packages/product-default/index.html",
        source / "webapp/packages/product-default/lib/index.html",
    ):
        if html.exists():
            html.write_text(
                html.read_text(encoding="utf-8").replace(
                    ">Loading...</", ">Carregando...</"
                ),
                encoding="utf-8",
            )
    base = source / "webapp/packages/core-localization/src"
    translations = json.loads(
        Path(__file__).with_name("pt-BR.json").read_text(encoding="utf-8")
    )
    (base / "locales/pt_BR.ts").write_text(
        "export default "
        + json.dumps(translations, ensure_ascii=False, indent=2)
        + " satisfies Record<string, string>;\n",
        encoding="utf-8",
    )
    service = base / "LocalizationService.ts"
    content = service.read_text(encoding="utf-8")
    if "import portuguese from" not in content:
        content = content.replace(
            "import { DEFAULT_LOCALE }",
            "import portuguese from './locales/pt_BR.js';\nimport { DEFAULT_LOCALE }",
            1,
        )
        content = content.replace(
            "this.supportedLanguages = locales;",
            "this.supportedLanguages = [{ isoCode: 'pt_BR', name: 'Português (Brasil)', nativeName: 'Português (Brasil)' }];",
            1,
        )
        content = content.replace(
            "this.localeMap.set(localeKey, locale);",
            "if (localeKey === 'pt_BR') {\n      for (const [key, value] of locale) locale.set(key, portuguese[value as keyof typeof portuguese] ?? value);\n    }\n    this.localeMap.set(localeKey, locale);",
            1,
        )
    if "locale.set(english, translated)" not in content:
        content = content.replace(
            "this.localeMap.set(localeKey, locale);",
            "if (localeKey === 'pt_BR') {\n      for (const [english, translated] of Object.entries(portuguese)) locale.set(english, translated);\n    }\n    this.localeMap.set(localeKey, locale);",
            1,
        )
    service.write_text(content, encoding="utf-8")
    form = (
        source
        / "webapp/packages/plugin-authentication/src/Dialog/AuthProviderForm/AuthProviderForm.tsx"
    )
    text = form.read_text(encoding="utf-8")
    if "const translate = useTranslate();" not in text:
        text = text.replace(
            "InputField, useFocus }", "InputField, useFocus, useTranslate }"
        )
        text = text.replace(
            "  const [elementRef]",
            "  const translate = useTranslate();\n  const [elementRef]",
            1,
        )
        text = text.replace(
            "{parameter.displayName}", "{translate(parameter.displayName ?? '')}"
        )
        form.write_text(text, encoding="utf-8")
    fields = (
        source
        / "webapp/packages/core-blocks/src/ObjectPropertyInfo/ObjectPropertyInfoForm/RenderField.tsx"
    )
    text = (
        fields.read_text(encoding="utf-8")
        .replace(
            "label={property.displayName}",
            "label={translate(property.displayName ?? '')}",
        )
        .replace(
            "{property.displayName ?? ''}", "{translate(property.displayName ?? '')}"
        )
    )
    fields.write_text(text, encoding="utf-8")
    default = base / "DEFAULT_LOCALE.ts"
    content = default.read_text(encoding="utf-8").replace(
        "isoCode: 'en', name: 'English'", "isoCode: 'pt_BR', name: 'Português (Brasil)'"
    )
    default.write_text(content, encoding="utf-8")
    print(f"Catálogo português aplicado: {len(translations)} textos.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    localize(parser.parse_args().source)
