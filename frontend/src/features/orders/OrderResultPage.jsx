import React, { useEffect, useRef, useState } from 'react';
import LabelSvg from './LabelSvg.jsx';
import ResultLabel from './ResultLabel.jsx';

const labelWidthPx = 105 / 25.4 * 96;

export default function OrderResultPage() {
    const params = new URLSearchParams(window.location.search);
    const district = params.get('chonHuyen') || '';
    const commune = params.get('chonXa') || '';
    const village = params.get('chonThon') || '';
    const barcode = params.get('barcode') || '';
    const recipientName = params.get('nhapTen') || '';
    const phone = params.get('nhapSdt') || '';
    const itemCount = params.get('soHang') || '';
    const itemName = params.get('tenHang') || '';
    const useSvgPreview = params.get('__renderer') !== 'legacy';
    const districtShort = district.split('.')[1] || '';
    const previewRef = useRef(null);
    const [previewScale, setPreviewScale] = useState(1);
    const [barcodeError, setBarcodeError] = useState(false);
    const [qrError, setQrError] = useState(false);
    const hasRequiredBarcode = Boolean(barcode);

    useEffect(() => {
        const element = previewRef.current;
        if (!element) return undefined;

        const observer = new ResizeObserver(entries => {
            const availableWidth = entries[0]?.contentRect.width || labelWidthPx;
            setPreviewScale(Math.min(1, availableWidth / labelWidthPx));
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const hasCodeError = barcodeError || qrError;

    return (
        <section className="result-page" aria-labelledby="result-page-title">
            <header className="result-page__heading">
                <div>
                    <p className="result-page__eyebrow">VTP · KẾT QUẢ</p>
                    <h1 id="result-page-title">Tem vận chuyển</h1>
                </div>
                {hasRequiredBarcode && (
                    <button
                        className="result-page__print"
                        type="button"
                        onClick={() => window.print()}
                        disabled={hasCodeError}
                    >
                        In tem A7
                    </button>
                )}
            </header>

            {!hasRequiredBarcode ? (
                <p className="result-page__error" role="alert">
                    Không tìm thấy mã vạch. Vui lòng quay lại và nhập mã vạch.
                </p>
            ) : (
                <>
                    {hasCodeError && (
                        <p className="result-page__error" role="alert">
                            Không thể tải đầy đủ QR hoặc mã vạch. Kiểm tra kết nối rồi thử lại trước khi in.
                        </p>
                    )}
                    <div
                        className="result-page__preview"
                        ref={previewRef}
                        style={{ '--label-preview-scale': previewScale }}
                    >
                        {useSvgPreview ? <LabelSvg
                            district={district}
                            districtShort={districtShort}
                            commune={commune}
                            village={village}
                            recipientName={recipientName}
                            phone={phone}
                            itemCount={itemCount}
                            itemName={itemName}
                            barcode={barcode}
                            barcodeError={barcodeError}
                            qrError={qrError}
                            onBarcodeError={() => setBarcodeError(true)}
                            onQrError={() => setQrError(true)}
                        /> : <ResultLabel
                            district={district}
                            districtShort={districtShort}
                            commune={commune}
                            village={village}
                            recipientName={recipientName}
                            phone={phone}
                            itemCount={itemCount}
                            itemName={itemName}
                            barcode={barcode}
                            barcodeError={barcodeError}
                            qrError={qrError}
                            onBarcodeError={() => setBarcodeError(true)}
                            onQrError={() => setQrError(true)}
                        />}
                    </div>
                </>
            )}
        </section>
    );
}