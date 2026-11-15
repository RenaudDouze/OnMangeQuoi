import QRCode from "qrcode";

export function renderQrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    margin: 1,
    // Modules en noir (valeur par défaut), fond transparent.
    color: { light: "#00000000" },
  });
}
