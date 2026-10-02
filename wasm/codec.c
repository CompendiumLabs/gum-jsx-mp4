#define H264E_SVC_API 0
#define H264E_MAX_THREADS 0
#define H264E_ENABLE_DENOISE 0
#define MINIH264_IMPLEMENTATION
#include "vendor/minih264e.h"

static H264E_create_param_t parameters(int width, int height, int gop) {
    H264E_create_param_t params = {0};
    params.width = width;
    params.height = height;
    params.gop = gop;
    params.const_input_flag = 1;
    return params;
}
int codec_sizes(int width, int height, int gop, int *persist, int *scratch) {
    H264E_create_param_t params = parameters(width, height, gop);
    return H264E_sizeof(&params, persist, scratch);
}
int codec_init(void *persist, int width, int height, int gop) {
    H264E_create_param_t params = parameters(width, height, gop);
    return H264E_init(persist, &params);
}
int codec_encode(void *persist, void *scratch, unsigned char *yuv, int width, int height,
                 int qp, unsigned char **data, int *size) {
    H264E_io_yuv_t frame = {{yuv, yuv + width * height, yuv + width * height * 5 / 4},
                          {width, width / 2, width / 2}};
    H264E_run_param_t params = {0};
    params.encode_speed = H264E_SPEED_BALANCED;
    params.qp_min = params.qp_max = qp;
    return H264E_encode(persist, scratch, &params, &frame, data, size);
}
