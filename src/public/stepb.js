// Externalized Step B page script to satisfy CSP (no inline scripts)
(function () {
  function qs(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  const token = qs('token');
  const tokenInput = document.getElementById('tokenInput');
  // preview helper used by camera capture and file inputs
  function previewFile(file, imgEl) {
    try {
      if (!imgEl) return;
      const url = URL.createObjectURL(file);
      imgEl.src = url;
      imgEl.style.display = 'block';
      // revoke URL after image loads to free memory
      imgEl.onload = () => {
        try {
          URL.revokeObjectURL(url);
        } catch (err) {
          console.warn('revoking object URL failed', err);
        }
      };
    } catch (err) {
      console.warn('preview failed', err);
    }
  }
  const commentsEl = document.getElementById('comments');
  const imageFront = document.getElementById('imageFront');
  const imageBack = document.getElementById('imageBack');
  const preview1 = document.getElementById('preview1');
  const preview2 = document.getElementById('preview2');
  const cameraFrontBtn = document.getElementById('cameraFrontBtn');
  const cameraBackBtn = document.getElementById('cameraBackBtn');
  const uploadBtn = document.getElementById('uploadBtn');
  const refreshBtn = document.getElementById('refresh');
  const messageEl = document.getElementById('message');
  const dateOfBirthEl = document.getElementById('dateOfBirth');
  const emailEl = document.getElementById('email');
  const streetAddressEl = document.getElementById('streetAddress');
  const addressEl = document.getElementById('address');
  const postalEl = document.getElementById('postal_address');
  const countryEl = document.getElementById('country');
  const ageEl = document.getElementById('age');
  const genderEl = document.getElementById('gender');
  const heightFeetEl = document.getElementById('heightFeet');
  const heightInchesEl = document.getElementById('heightInches');
  const weightLbsEl = document.getElementById('weightLbs');
  const interestedProcedureEl = document.getElementById('interestedProcedure');
  const insuranceEmployerNameEl = document.getElementById('insuranceEmployerName');

  if (tokenInput) tokenInput.value = token || '';

  function setMessage(text, isError) {
    if (!messageEl) return;
    messageEl.textContent = text || '';
    messageEl.style.color = isError ? '#a33' : '#1b4f72';
  }

  async function fetchStatus() {
    if (!token) {
      setMessage('Missing or invalid link.', true);
      return;
    }
    setMessage('Checking link...');
    try {
      const res = await fetch('/api/form/status?token=' + encodeURIComponent(token));
      if (!res.ok) {
        // try to parse JSON error, fallback to text
        let msg = 'Invalid or expired link.';
        try {
          const j = await res.json();
          msg = j && j.error ? j.error : j && j.message ? j.message : msg;
        } catch (e) {
          try {
            const t = await res.text();
            if (t) msg = t;
          } catch (e2) {
            console.warn('fetch status: could not read text body', e2);
          }
        }
        setMessage(msg, true);
        return;
      }
      const json = await res.json();
      if (json.stepBCompleted) {
        setMessage('Your submission is already complete. Thank you.');
        // disable form inputs
        const form = document.getElementById('stepBForm');
        if (form)
          Array.from(form.querySelectorAll('input,textarea,button')).forEach(
            (el) => (el.disabled = true)
          );
      } else {
        setMessage('You may complete the remaining fields and submit below.');
      }
    } catch (err) {
      console.error('status check failed', err);
      setMessage('Could not verify link. Please try again.', true);
    }
  }
  // Detect mobile device for camera-first UX when needed (checked inline)
  function showCameraCapture(target) {
    // Try getUserMedia; if not available, trigger file input click as fallback
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      // fallback to file input
      target.click();
      return;
    }

    // build modal elements
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.left = 0;
    overlay.style.top = 0;
    overlay.style.right = 0;
    overlay.style.bottom = 0;
    overlay.style.background = 'rgba(0,0,0,0.7)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = 10000;

    const box = document.createElement('div');
    box.style.background = '#fff';
    box.style.padding = '8px';
    box.style.borderRadius = '8px';
    box.style.maxWidth = '420px';
    box.style.width = '90%';

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.style.width = '100%';
    video.style.borderRadius = '6px';
    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.justifyContent = 'space-between';
    controls.style.marginTop = '8px';
    const capBtn = document.createElement('button');
    capBtn.textContent = 'Capture';
    capBtn.className = 'btn';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'btn';

    controls.appendChild(cancelBtn);
    controls.appendChild(capBtn);
    box.appendChild(video);
    box.appendChild(controls);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    let stream;
    const constraints = { video: { facingMode: 'environment' }, audio: false };

    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((s) => {
        stream = s;
        video.srcObject = stream;
      })
      .catch((err) => {
        console.warn('camera error', err);
        document.body.removeChild(overlay);
        target.click();
      });

    cancelBtn.addEventListener('click', () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      document.body.removeChild(overlay);
    });

    capBtn.addEventListener('click', async () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.8));
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
        if (target === imageFront) {
          // set file into input via DataTransfer
          const dt = new DataTransfer();
          dt.items.add(file);
          imageFront.files = dt.files;
          previewFile(file, preview1);
        } else {
          const dt = new DataTransfer();
          dt.items.add(file);
          imageBack.files = dt.files;
          previewFile(file, preview2);
        }
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
        }
        document.body.removeChild(overlay);
      } catch (e) {
        console.error('capture failed', e);
      }
    });
  }

  cameraFrontBtn && cameraFrontBtn.addEventListener('click', () => showCameraCapture(imageFront));
  cameraBackBtn && cameraBackBtn.addEventListener('click', () => showCameraCapture(imageBack));

  // wire file input previews
  if (imageFront)
    imageFront.addEventListener('change', () => {
      const f = imageFront.files && imageFront.files[0];
      if (f) previewFile(f, preview1);
      else preview1.style.display = 'none';
    });
  if (imageBack)
    imageBack.addEventListener('change', () => {
      const f = imageBack.files && imageBack.files[0];
      if (f) previewFile(f, preview2);
      else preview2.style.display = 'none';
    });

  async function uploadAndSubmit() {
    setMessage('Preparing upload...');
    if (!token) {
      setMessage('Missing token in URL', true);
      return;
    }
    const file1 = imageFront && imageFront.files && imageFront.files[0];
    const file2 = imageBack && imageBack.files && imageBack.files[0];

    // Compress/resize images client-side to reduce payload in fallback mode
    async function compressImage(file, maxWidth = 1280, quality = 0.7) {
      return new Promise((resolve, reject) => {
        try {
          const img = new Image();
          img.onload = () => {
            const scale = Math.min(1, maxWidth / img.width);
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(
              (blob) => {
                if (!blob) return reject(new Error('Compression failed'));
                // convert blob to File-like object
                const compressed = new File([blob], file.name, { type: 'image/jpeg' });
                resolve(compressed);
              },
              'image/jpeg',
              quality
            );
          };
          img.onerror = (e) => reject(e || new Error('Image load error'));
          const reader = new FileReader();
          reader.onload = (e) => {
            img.src = e.target.result;
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        } catch (e) {
          reject(e);
        }
      });
    }

    // compress files (only if present)
    let c1 = file1;
    let c2 = file2;
    if (file1) {
      try {
        c1 = await compressImage(file1);
      } catch (e) {
        console.warn('compress1 failed', e);
      }
    }
    if (file2) {
      try {
        c2 = await compressImage(file2);
      } catch (e) {
        console.warn('compress2 failed', e);
      }
    }

    const files = [];
    if (c1) files.push({ name: c1.name, type: c1.type || 'image/jpeg' });
    if (c2) files.push({ name: c2.name, type: c2.type || 'image/jpeg' });

    let presignResp;
    try {
      const res = await fetch('/api/form/presign?token=' + encodeURIComponent(token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });
      presignResp = await res.json();
    } catch (err) {
      console.error('Presign error', err);
      setMessage('Could not get upload URLs. Trying fallback submission.', true);
    }

    const imageObjects = [];

    // If presignResp.presigned is present, use it. Otherwise, fallback to embedding base64 data.
    // server returns { presigned: [...] } or { files: [...] } depending on environment
    const presignedList =
      presignResp && Array.isArray(presignResp.presigned) && presignResp.presigned.length
        ? presignResp.presigned
        : presignResp && Array.isArray(presignResp.files)
          ? presignResp.files
          : [];
    if (presignedList && presignedList.length) {
      try {
        const presigned = presignedList;
        const uploadPromises = presigned.map(async (p, idx) => {
          const file = idx === 0 ? c1 : c2;
          if (!file) return null;
          const putUrl = p.putUrl || p.url || p.uploadUrl;
          const publicUrl = p.url || (putUrl ? putUrl.split('?')[0] : null);
          if (putUrl) {
            await fetch(putUrl, {
              method: 'PUT',
              headers: { 'Content-Type': p.contentType || file.type || 'application/octet-stream' },
              body: file,
            });
            imageObjects.push({
              key: p.key || null,
              url: publicUrl,
              contentType: p.contentType || file.type,
            });
          } else {
            // no putUrl — cannot upload to S3; fallback to embedding
            const dataUrl = await fileToDataUrl(file);
            imageObjects.push({ filename: file.name, dataUrl, contentType: file.type });
          }
        });
        await Promise.all(uploadPromises);
      } catch (err) {
        console.error('Upload failed', err);
        setMessage('Upload failed. ' + (err.message || ''), true);
        return;
      }
    } else {
      // Fallback: convert present files to data URLs and include inline
      try {
        if (c1) {
          const d1 = await fileToDataUrl(c1);
          imageObjects.push({ filename: c1.name, dataUrl: d1, contentType: c1.type });
        }
        if (c2) {
          const d2 = await fileToDataUrl(c2);
          imageObjects.push({ filename: c2.name, dataUrl: d2, contentType: c2.type });
        }
      } catch (err) {
        console.error('Fallback conversion failed', err);
        setMessage('Could not prepare files for submission.', true);
        return;
      }
    }

    // Build final payload using model keys
    const payload = {
      dateOfBirth: dateOfBirthEl ? dateOfBirthEl.value : null,
      email: emailEl ? emailEl.value : null,
      streetAddress: streetAddressEl ? streetAddressEl.value : null,
      address: addressEl ? addressEl.value : null,
      postal_address: postalEl ? postalEl.value : null,
      country: countryEl ? countryEl.value : null,
      age: ageEl && ageEl.value ? parseInt(ageEl.value, 10) : null,
      gender: genderEl ? genderEl.value || null : null,
      heightFeet: heightFeetEl && heightFeetEl.value ? parseInt(heightFeetEl.value, 10) : null,
      heightInches:
        heightInchesEl && heightInchesEl.value ? parseInt(heightInchesEl.value, 10) : null,
      weightLbs: weightLbsEl && weightLbsEl.value ? parseFloat(weightLbsEl.value) : null,
      interestedProcedure: interestedProcedureEl ? interestedProcedureEl.value : null,
      priorWeightLossSurgery:
        (document.querySelector('input[name="priorWeightLossSurgery"]:checked') || {}).value ===
        'yes',
      wheelchairUsage:
        (document.querySelector('input[name="wheelchairUsage"]:checked') || {}).value === 'yes',
      hasSecondaryInsurance:
        (document.querySelector('input[name="hasSecondaryInsurance"]:checked') || {}).value ===
        'yes',
      insuranceEmployerName: insuranceEmployerNameEl ? insuranceEmployerNameEl.value : null,
      imageObjects,
      answers: { comments: commentsEl ? commentsEl.value : '' },
    };

    setMessage('Submitting final data...');
    try {
      const res = await fetch('/api/form/submit?token=' + encodeURIComponent(token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (res.ok) {
        setMessage('Submission complete. Thank you!');
        // Refresh status
        setTimeout(() => fetchStatus(), 800);
      } else {
        console.error('Submit error', json);
        setMessage(json.error || 'Server rejected submission', true);
      }
    } catch (err) {
      console.error('Submit exception', err);
      setMessage('Submission failed: ' + (err.message || err), true);
    }
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  uploadBtn &&
    uploadBtn.addEventListener('click', () => {
      uploadBtn.disabled = true;
      uploadAndSubmit().finally(() => (uploadBtn.disabled = false));
    });

  refreshBtn && refreshBtn.addEventListener('click', fetchStatus);

  // Initial run
  fetchStatus();
})();
