/// <reference types="vite/client" />

declare module "jspdf" {
  export default class jsPDF {
    internal: {
      pageSize: {
        getWidth(): number;
      };
    };

    constructor(options?: Record<string, unknown>);
    setFillColor(r: number, g: number, b: number): void;
    rect(x: number, y: number, width: number, height: number, style?: string): void;
    circle(x: number, y: number, radius: number, style?: string): void;
    setTextColor(r: number, g: number, b: number): void;
    setFont(fontName: string, fontStyle?: string): void;
    setFontSize(size: number): void;
    text(text: string | string[], x: number, y: number): void;
    setDrawColor(r: number, g: number, b: number): void;
    roundedRect(x: number, y: number, width: number, height: number, rx: number, ry: number, style?: string): void;
    line(x1: number, y1: number, x2: number, y2: number): void;
    addImage(imageData: string, format: string, x: number, y: number, width: number, height: number): void;
    save(filename: string): void;
  }
}
