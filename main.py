from pyVHR.analysis.pipeline import Pipeline
from pyVHR.plot.visualize import *
from pyVHR.utils.errors import displayErrors, getErrors, printErrors

# params
wsize = 6  # window size in seconds
roi_approach = "patches"  # 'holistic' or 'patches'
bpm_est = (
    "clustering"  # BPM final estimate, if patches choose 'medians' or 'clustering'
)
method = "cpu_CHROM"  # one of the methods implemented in pyVHR

# run
pipe = Pipeline()  # object to execute the pipeline
bvps, timesES, bpmES = pipe.run_on_video(
    videoFileName,
    winsize=wsize,
    roi_method="convexhull",
    roi_approach=roi_approach,
    method=method,
    estimate=bpm_est,
    patch_size=0,
    RGB_LOW_HIGH_TH=(5, 230),
    Skin_LOW_HIGH_TH=(5, 230),
    pre_filt=True,
    post_filt=True,
    cuda=True,
    verb=True,
)

# ERRORS
RMSE, MAE, MAX, PCC, CCC, SNR = getErrors(bvps, fps, bpmES, bpmGT, timesES, timesGT)
printErrors(RMSE, MAE, MAX, PCC, CCC, SNR)
displayErrors(bpmES, bpmGT, timesES, timesGT)
