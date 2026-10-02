import React from 'react';
import a7Template from '../../../../a7.svg';

const viewBoxScale = 10 * 25.4 / 96;
const toViewBox = value => value * viewBoxScale;
let measureContext;

function textWidth(text, fontSize, fontWeight) {
    if (typeof document === 'undefined') return text.length * fontSize * 0.55;
    if (!measureContext) measureContext = document.createElement('canvas').getContext('2d');
    measureContext.font = `${fontWeight} ${fontSize}px "Times New Roman", serif`;
    return measureContext.measureText(text).width;
}

function fitLine(value, maxWidth, fontSize, fontWeight, minScale = 0.78) {
    const text = String(value ?? '');
    const width = textWidth(text, fontSize, fontWeight);
    if (width <= maxWidth || !width) return { text, fontSize };

    const scaledSize = fontSize * maxWidth / width;
    if (scaledSize >= fontSize * minScale) return { text, fontSize: scaledSize };

    const finalSize = fontSize * minScale;
    const characters = Array.from(text.normalize('NFC'));
    let low = 0;
    let high = characters.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (textWidth(`${characters.slice(0, middle).join('')}…`, finalSize, fontWeight) <= maxWidth) low = middle;
        else high = middle - 1;
    }
    return { text: `${characters.slice(0, low).join('')}…`, fontSize: finalSize };
}

function wrapLines(value, maxWidth, fontSize, fontWeight, maxLines = 2) {
    const words = String(value ?? '').trim().split(/\s+/u).filter(Boolean);
    if (!words.length) return [''];

    const lines = [];
    let line = '';
    for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && textWidth(candidate, fontSize, fontWeight) > maxWidth) {
            lines.push(line);
            line = word;
        } else {
            line = candidate;
        }
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines) return lines;

    const result = lines.slice(0, maxLines);
    const previous = result[maxLines - 1];
    const remaining = lines.slice(maxLines - 1).join(' ');
    result[maxLines - 1] = fitLine(`${previous} ${remaining}`, maxWidth, fontSize, fontWeight).text;
    return result;
}

function LabelText({ x, y, value, fontSize = 10, fontWeight = 500, maxWidth, uppercase = false }) {
    const text = uppercase ? String(value ?? '').toLocaleUpperCase('vi-VN') : String(value ?? '');
    const fitted = maxWidth ? fitLine(text, maxWidth, fontSize, fontWeight) : { text, fontSize };
    return (
        <text
            x={toViewBox(x)}
            y={toViewBox(y)}
            fill="#000"
            fontFamily="Times New Roman, serif"
            fontSize={toViewBox(fitted.fontSize)}
            fontWeight={fontWeight}
        >
            {fitted.text}
            {fitted.text !== text && <title>{text}</title>}
        </text>
    );
}

export default function LabelSvg({
    district,
    districtShort,
    commune,
    village,
    recipientName,
    phone,
    itemCount,
    itemName,
    barcode,
    barcodeError,
    qrError,
    onBarcodeError,
    onQrError,
}) {
    const encodedBarcode = encodeURIComponent(barcode);
    const address = `${village}, X.${commune}, ${district}, T.Lào Cai`;
    const itemNameLines = wrapLines(itemName, 275, 10, 500, 2);
    const lowerRowOffset = itemNameLines.length > 1 ? 12.5 : 0;

    return (
        <svg
            aria-label={`Tem vận chuyển ${barcode}`}
            className="result-label-svg"
            height="74mm"
            role="img"
            viewBox="0 0 1050 740"
            width="105mm"
            xmlns="http://www.w3.org/2000/svg"
        >
            <title>Tem vận chuyển {barcode}</title>
            <image href={a7Template} x="0" y="0" width="1050" height="740" preserveAspectRatio="none" />
            <rect
                x={toViewBox(0.5)}
                y={toViewBox(0.5)}
                width={1050 - toViewBox(1)}
                height={740 - toViewBox(1)}
                fill="none"
                stroke="#000"
                strokeWidth={toViewBox(1)}
            />

            <circle cx={toViewBox(371.34)} cy={toViewBox(12.5)} r={toViewBox(11.75)} fill="none" stroke="#000" strokeWidth={toViewBox(1.5)} />
            <text x={toViewBox(371.34)} y={toViewBox(17.8)} fill="#000" fontFamily="Times New Roman, serif" fontSize={toViewBox(15)} fontWeight="700" textAnchor="middle">54</text>
            <LabelText x={71} y={18.05} value="lào cai" fontSize={15} fontWeight={700} uppercase />
            <LabelText x={71} y={43} value={districtShort} fontSize={20} fontWeight={700} uppercase maxWidth={205} />
            <LabelText x={71} y={69.05} value={commune} fontSize={15} fontWeight={700} uppercase maxWidth={205} />

            <text fill="#000" fontFamily="Times New Roman, serif" fontSize={toViewBox(11)} fontWeight="700">
                <tspan x={toViewBox(122.84)} y={toViewBox(82)} fontWeight="400">0.05 /</tspan>
                <tspan x={toViewBox(147.91)} y={toViewBox(83)}>0.05 Kg / --- (cm) /</tspan>
                <tspan x={toViewBox(233.44)} y={toViewBox(83)}>NHANH / NỘI MIỀN / TTKT1</tspan>
            </text>

            {barcodeError ? (
                <text x={toViewBox(92.4)} y={toViewBox(116)} fill="#a32626" fontFamily="Arial, sans-serif" fontSize={toViewBox(10)}>Không tải được mã vạch</text>
            ) : (
                <image
                    aria-label="Mã vạch"
                    href={`/api/barcode?text=${encodedBarcode}`}
                    x={toViewBox(92.4)}
                    y={toViewBox(96)}
                    width={toViewBox(212)}
                    height={toViewBox(50)}
                    preserveAspectRatio="none"
                    onError={onBarcodeError}
                />
            )}

            {qrError ? (
                <text x={toViewBox(306.8)} y={toViewBox(195)} fill="#a32626" fontFamily="Arial, sans-serif" fontSize={toViewBox(10)}>Không tải được mã QR</text>
            ) : (
                <image
                    aria-label="Mã QR"
                    href={`/api/qrcode?text=${encodedBarcode}`}
                    x={toViewBox(306.8)}
                    y={toViewBox(161)}
                    width={toViewBox(65)}
                    height={toViewBox(65)}
                    preserveAspectRatio="none"
                    onError={onQrError}
                />
            )}

            <LabelText x={16} y={163} value={`${recipientName} / ${phone || '**********'}`} maxWidth={275} />
            <LabelText x={16} y={177} value={address} maxWidth={275} />
            <text x={toViewBox(16)} y={toViewBox(194)} fill="#000" fontFamily="Times New Roman, serif" fontSize={toViewBox(10)} fontWeight="500">
                {itemNameLines.map((line, index) => (
                    <tspan key={`${index}-${line}`} x={toViewBox(16)} dy={index === 0 ? 0 : toViewBox(12.5)}>{line}</tspan>
                ))}
            </text>
            <LabelText x={16} y={212 + lowerRowOffset} value={itemCount} maxWidth={275} />
            <LabelText x={75} y={234 + lowerRowOffset} value="********* đ" fontSize={14} fontWeight={700} maxWidth={150} />
            <LabelText x={206} y={231 + lowerRowOffset} value="0đ" />
        </svg>
    );
}