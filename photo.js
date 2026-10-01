// 將手機原圖轉為JPEG，上傳目標1.5MB，低於後端限制。
async function prepareWarehousePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('無法讀取照片');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('此瀏覽器無法處理照片');
    let scale = Math.min(1,1600 / Math.max(image.naturalWidth,image.naturalHeight));
    for (let sizeStep=0;sizeStep<8;sizeStep++) {
      canvas.width = Math.max(1,Math.round(image.naturalWidth*scale));
      canvas.height = Math.max(1,Math.round(image.naturalHeight*scale));
      context.fillStyle = '#ffffff';
      context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(image,0,0,canvas.width,canvas.height);
      for (const quality of [0.85,0.7,0.55]) {
        const photo = canvas.toDataURL('image/jpeg',quality);
        const base64 = photo.split(',')[1];
        if (photo.startsWith('data:image/jpeg;base64,') && base64 && base64.length <= 2000000) return photo;
      }
      scale *= 0.75;
    }
    throw new Error('照片壓縮後仍過大，請選擇其他照片');
  } catch (error) {
    throw new Error(error.message === '照片壓縮後仍過大，請選擇其他照片' ? error.message : '無法處理此照片，請改用JPEG或PNG格式');
  } finally { URL.revokeObjectURL(url); }
}
