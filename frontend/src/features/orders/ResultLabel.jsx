import React from 'react';

export default function ResultLabel({
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

    return (
        <div id="container">
            <div id="container-swap" className="result-label">
                <h1 id="sst"><span>54</span></h1>
                <h1 id="tinh">lào cai</h1>
                <h2 id="huyen1">{districtShort}</h2>
                <h1 id="xa1">{commune}</h1>
                <div id="hinh-thuc">
                    <p id="kl">0.05 /</p>
                    <p id="kl-kt">0.05 Kg / --- (cm) /</p>
                    <p id="htvc">Nhanh / nội miền / ttkt1</p>
                </div>
                <div id="barcode">
                    {barcodeError ? (
                        <span className="result-code-missing">Không tải được mã vạch</span>
                    ) : (
                        <img
                            id="bar-code"
                            src={`/api/barcode?text=${encodedBarcode}`}
                            alt="Mã vạch"
                            onError={onBarcodeError}
                        />
                    )}
                </div>
                <div id="qrcode">
                    {qrError ? (
                        <span className="result-code-missing">Không tải được mã QR</span>
                    ) : (
                        <img
                            id="qr-code"
                            src={`/api/qrcode?text=${encodedBarcode}`}
                            alt="Mã QR"
                            onError={onQrError}
                        />
                    )}
                </div>
                <p id="ten-sdt"><span id="ten">{recipientName}</span> / <span id="sdt">{phone || '**********'}</span></p>
                <p id="dia-chi"><span id="thon">{village}</span>, X.<span id="xa2">{commune}</span>, <span id="huyen2">{district}</span>, T.Lào Cai</p>
                <p id="ghi-chu"><span id="ten-hang">{itemName}</span></p>
                <p id="so-hang"><span id="so-hang-value">{itemCount}</span></p>
                <p id="so-tien">*********<span id="tien"></span> đ</p>
                <p id="cuoc"><span id="cuocd">0</span>đ</p>
            </div>
        </div>
    );
}