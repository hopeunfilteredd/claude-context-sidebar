"""Packs extension/ into releases/<name>-<version>.vsix using the same layout as the official packaging tool (vsce),
with the standard library only. Run from the repository root: python3 scripts/pack_vsix.py"""
import json, os, zipfile
from xml.sax.saxutils import escape

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ext = os.path.join(root, "extension")
pk = json.load(open(os.path.join(ext, "package.json")))
name, ver, pub = pk["name"], pk["version"], pk["publisher"]
repo = pk.get("repository", {}).get("url", "")
home = pk.get("homepage", "")
bugs = pk.get("bugs", {}).get("url", "")
engine = pk["engines"]["vscode"]
cats = ",".join(pk.get("categories", ["Other"]))
tags = ",".join(pk.get("keywords", []))

content_types = ('<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  '<Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/>'
  '<Default Extension=".svg" ContentType="image/svg+xml"/><Default Extension=".png" ContentType="image/png"/>'
  '<Default Extension=".md" ContentType="text/markdown"/><Default Extension=".txt" ContentType="text/plain"/>'
  '<Default Extension=".vsixmanifest" ContentType="text/xml"/></Types>')

def prop(i, v): return f'      <Property Id="{i}" Value="{escape(v)}" />\n'
props = (prop("Microsoft.VisualStudio.Code.Engine", engine) + prop("Microsoft.VisualStudio.Code.ExtensionDependencies", "") +
  prop("Microsoft.VisualStudio.Code.ExtensionPack", "") + prop("Microsoft.VisualStudio.Code.ExtensionKind", "workspace") +
  prop("Microsoft.VisualStudio.Code.LocalizedLanguages", "") + prop("Microsoft.VisualStudio.Code.EnabledApiProposals", "") +
  prop("Microsoft.VisualStudio.Code.ExecutesCode", "true") +
  (prop("Microsoft.VisualStudio.Services.Links.Source", repo) + prop("Microsoft.VisualStudio.Services.Links.Getstarted", repo) +
   prop("Microsoft.VisualStudio.Services.Links.GitHub", repo) + prop("Microsoft.VisualStudio.Services.Links.Support", bugs) +
   prop("Microsoft.VisualStudio.Services.Links.Learn", home) if repo else "") +
  prop("Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown", "true") + prop("Microsoft.VisualStudio.Services.Content.Pricing", "Free"))

manifest = f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="{name}" Version="{ver}" Publisher="{pub}" />
    <DisplayName>{escape(pk['displayName'])}</DisplayName>
    <Description xml:space="preserve">{escape(pk['description'])}</Description>
    <Tags>{escape(tags)}</Tags>
    <Categories>{escape(cats)}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
{props}    </Properties>
    <License>extension/LICENSE.txt</License>
    <Icon>extension/icon.png</Icon>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/icon.png" Addressable="true" />
  </Assets>
</PackageManifest>'''

os.makedirs(os.path.join(root, "releases"), exist_ok=True)
out = os.path.join(root, "releases", f"{name}-{ver}.vsix")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", content_types)
    z.writestr("extension.vsixmanifest", manifest)
    for f in ["package.json", "extension.js", "icon.png", "icon.svg", "README.md"]:
        z.write(os.path.join(ext, f), "extension/" + f)
    z.write(os.path.join(ext, "LICENSE"), "extension/LICENSE.txt")
print("packed", out, os.path.getsize(out), "bytes")
