volatile __data signed char sc_min, sc_max, sc_negative_one;
volatile __data unsigned char uc_max, uc_zero;
volatile __data signed int si_min, si_max, si_negative_one;
volatile __data unsigned int ui_max, ui_zero;
volatile __xdata signed long sl_min, sl_max, sl_negative_one;
volatile __xdata unsigned long ul_max, ul_zero;
__code signed long code_negative = -2147483647L;
volatile __idata unsigned char idata_max;
volatile __data _Bool boolean_value;
enum Choice { NEGATIVE = -1, POSITIVE = 2 };
volatile __data enum Choice enum_value;
volatile __bit bit_value;
volatile __xdata long long ll_value;
volatile __data float float_value;
volatile __data unsigned char array_value[2];
unsigned char *pointer_value;
struct Pair { unsigned char a; unsigned char b; } pair_value;
void main(void) {
 idata_max=255; sc_negative_one=-1; si_negative_one=-1; sl_negative_one=-1;
 uc_zero=0; ui_zero=0; ul_zero=0;
 sc_min=-128; sc_max=127; uc_max=255;
 si_min=(-32767-1); si_max=32767; ui_max=65535u;
 sl_min=(-2147483647L-1); sl_max=2147483647L; ul_max=4294967295UL;
 boolean_value=1; enum_value=NEGATIVE; bit_value=1;
 ll_value=-1; float_value=1.5; array_value[0]=255; array_value[1]=0;
 while(1) {}
}
