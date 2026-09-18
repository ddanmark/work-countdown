/* ============================================================
   zstd.js — 由 tools/vendor-cimbar.js 从 libcimbar v0.6.8 官方发布包加工而来，请勿手改。
   上游：https://github.com/sz3/libcimbar （MPL-2.0，见同目录 LICENSE-libcimbar.txt）
   本地改动：无（原样 vendored；download_blob 可在调用方覆盖）
   要升级：改 tools/vendor-cimbar.js 里的 VERSION / BUILD 后重新运行。
   ============================================================ */
var Zstd = function () {

  var _decompBuff = undefined;

  function getDecompressReader(id) {
    // allocate buffer once. We'll reuse it,
    // and slice() to copy to the local (non-wasm) heap
    const bufferSize = Module._cimbard_get_decompress_bufsize(); // chunk size
    if (_decompBuff === undefined)
      _decompBuff = Module._malloc(bufferSize);

    const readstream = new ReadableStream({
      start(controller) { },
      pull(controller) {
        const bytesRead = Module._cimbard_decompress_read(id, _decompBuff, bufferSize);
        console.log("reader got " + bytesRead);
        if (bytesRead <= 0) {
          // No more data, close the stream
          controller.close();
        } else {
          // Copy the data from WASM memory to a JavaScript Uint8Array
          const chunk = new Uint8Array(Module.HEAPU8.buffer, _decompBuff, bytesRead).slice();
          controller.enqueue(chunk);
        }
      },
      cancel() {
        // Handle cancellation if needed
      }
    });
    return readstream;
  }


  async function saveViaStreaming(readstream, filename) {
    // afaik there's no way to get the save file picker to activate
    // without user input? Which ... sucks?
    alert("download ready!");
    try {
      // 1. Prompt user for a file location.
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: filename,
      });

      // 2. Create a writable stream directly to the file.
      const writableStream = await fileHandle.createWritable();

      // 3. Pipe the data from your source to the file on disk.
      await readstream.pipeTo(writableStream);

      console.log('File saved successfully!');
    } catch (error) {
      // Handle errors, like the user canceling the dialog.
      console.error('File save failed:', error);
    }
  }

  async function saveViaBlob(readstream, filename) {
    // Create Response object from the stream, get blob
    const response = new Response(readstream);
    const blob = await response.blob();
    console.log("download is ready for " + filename + ", size " + blob.size);
    Zstd.download_blob(filename, blob);
  }

  function saveToFile(readstream, filename) {
    ///if (window.showSaveFilePicker == undefined)
    saveViaBlob(readstream, filename);
    //else
    //  saveViaStreaming(readstream, filename);
  }

  // public interface
  return {

    // helper
    download_blob: function (name, blob) {
      var bloburl = window.URL.createObjectURL(blob);
      var aaa = document.createElement('a');
      aaa.href = bloburl;
      aaa.download = name;
      document.body.appendChild(aaa);
      aaa.style = 'display: none';
      aaa.click();

      setTimeout(function () {
        aaa.remove();
        return window.URL.revokeObjectURL(bloburl);
      }, 1000);
    },

    decompress: function (name, id) {
      const reader = getDecompressReader(id);

      saveToFile(reader, name);
    }
  };
}();
